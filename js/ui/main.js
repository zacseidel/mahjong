// Game page bootstrap: load the card, build the table, and wire the session to the UI.

import { h, mount, button } from './dom.js';
import { Rack } from './rack.js';
import { Session } from './session.js';
import { renderOpponent, renderCenter, renderMyExposures } from './table.js';
import { renderPrompt } from './prompt.js';
import { showEndOfHand, showCard, showSettings, showOpponent, openModal, closeModal } from './modals.js';
import { nameOf, windOf } from './format.js';
import { loadCards, saveCards, loadSettings, saveSettings, loadLedger, saveLedger } from '../storage.js';
import { makeRecord, appendRecord } from '../ledger.js';
import { PRACTICE_ID, getCard, setActive, putCard, importCard, playableHands } from '../cardStore.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

let practiceCard = null;
async function loadPractice() {
  if (practiceCard) return practiceCard;
  const res = await fetch('data/practice-card.json');
  if (!res.ok) throw new Error(`Could not load the practice card (${res.status}).`);
  practiceCard = await res.json();
  return practiceCard;
}

/**
 * The card to play with: the active card from this browser's library, or the practice card.
 * @returns {Promise<{card: Object|null, problem?: string}>}
 */
async function loadActiveCard() {
  const store = loadCards();
  if (store.activeId !== PRACTICE_ID) {
    const card = getCard(store, store.activeId);
    if (card && playableHands(card) > 0) return { card };
    return { card: null, problem: `Your chosen card, “${card?.name ?? 'unknown'}”, has no playable hands yet.` };
  }
  try {
    return { card: await loadPractice() };
  } catch (e) {
    return { card: null, problem: `${e.message} If you opened this file directly, serve the folder instead (for example: python3 -m http.server 8000).` };
  }
}

const layout = {
  top: h('section', { class: 'opp opp-top', 'aria-label': 'Across' }),
  left: h('section', { class: 'opp opp-left', 'aria-label': 'Left' }),
  right: h('section', { class: 'opp opp-right', 'aria-label': 'Right' }),
  center: h('section', { class: 'center', 'aria-label': 'Discards' }),
  me: h('section', { class: 'me', 'aria-label': 'Your hand' }),
  side: h('aside', { class: 'side', 'aria-label': 'Tips' }),
};
const myHead = h('div', { class: 'me-head' });
const myExposures = h('div', { class: 'exposures my-exposures', 'aria-label': 'Your exposures' });
const promptEl = h('div', { class: 'prompt' });
const rackEl = h('div', { class: 'rack', role: 'group', 'aria-label': 'Your rack' });
const rackTools = h('div', { class: 'rack-tools' });
layout.me.append(myHead, myExposures, promptEl, h('div', { class: 'rack-wrap' }, rackEl, rackTools));

/** Hooks stage 7 (tips) plugs into. */
export const hooks = {
  renderSide: null,     // (el, obs, session, ui) => void
  decorate: null,       // (obs, rack, ui) => void — rack highlights and danger marks
  opponentExtra: null,  // (obs, seat) => HTMLElement
  opponentBadges: null, // (obs, seat) => HTMLElement[]
  endExtra: null,       // (record, session) => HTMLElement
  settingsSections: null, // (settings, onChange) => HTMLElement[]
  onHumanAction: null,  // (obs, action) => void — before the action is applied
  onNewHand: null,      // () => void
  getSettings: () => session?.settings,
};

let session;
let rack;
let settings;
const sessionId = new Date().toISOString();
let handTipsOn = false;
let ledgerWarned = false;
let lastState = null;
// The tips panel starts open where it fits beside the table, closed where it would overlay it.
const ui = { blind: 0, claimJokers: {}, sideOpen: window.matchMedia('(min-width: 1101px)').matches, highlightHand: null };

function render() {
  if (!session?.state) return;
  if (session.state !== lastState) {
    lastState = session.state;
    rack.reset();
    ui.blind = 0;
    ui.claimJokers = {};
    ui.highlightHand = null;
    hooks.onNewHand?.();
    handTipsOn = false;
  }
  const obs = session.observation();
  const human = obs.seat;
  const seatAt = (k) => (human + k) % 4;
  const thinking = session.aiThinking;
  const opp = (el, seat) => renderOpponent(el, obs, seat, {
    level: session.settings.levels[seat],
    badges: hooks.opponentBadges?.(obs, seat) ?? [],
    onOpen: () => showOpponent(obs, seat, hooks.opponentExtra?.(obs, seat) ?? null),
  });
  opp(layout.right, seatAt(1));
  opp(layout.top, seatAt(2));
  opp(layout.left, seatAt(3));
  renderCenter(layout.center, obs, { thinking });
  mount(myHead,
    h('span', { class: 'opp-name' }, 'You'),
    h('span', { class: 'wind-badge' }, windOf(human, obs.dealer)),
    obs.dead[human] ? h('span', { class: 'badge badge-dead' }, 'Dead') : null,
    h('span', { class: 'score' }, `Session: ${session.totals[human] >= 0 ? '+' : ''}${session.totals[human]}`));
  layout.me.classList.toggle('is-turn', obs.turnSeat === human);
  renderMyExposures(myExposures, obs);
  rack.sync(obs.hand);
  renderPrompt(promptEl, obs, rack, { act: humanAct, ui, rerender: render, thinking });
  rack.highlight = new Set();
  rack.marks = new Map();
  hooks.decorate?.(obs, rack, ui);
  rack.render();
  if (hooks.renderSide && ui.sideOpen) hooks.renderSide(layout.side, obs, session, ui, render, humanAct);
  app.classList.toggle('side-closed', !ui.sideOpen || !hooks.renderSide);
}

function humanAct(action) {
  const obs = session.observation();
  if (settings.tips.offense || settings.tips.defense) handTipsOn = true;
  hooks.onHumanAction?.(obs, action);
  const error = session.act(action);
  if (error) toast(error);
  else rack.clearSelection();
}

/** Save the finished hand to the ledger (SPEC §11.3). */
function recordHand(record) {
  const state = session.state;
  const rec = makeRecord({
    timestamp: new Date().toISOString(),
    sessionId,
    seed: record.seed,
    dealer: record.dealer,
    human: record.human,
    cardId: record.cardId ?? PRACTICE_ID,
    cardName: state.card.name,
    result: record.result,
    tipsOn: handTipsOn,
    fold: hooks.handReport?.()?.fold ?? { suggested: 0, followed: 0 },
    decisions: state.actions.filter((a) => a.seat === record.human).map((a) => a.action),
  });
  if (!saveLedger(appendRecord(loadLedger(), rec)) && !ledgerWarned) {
    ledgerWarned = true;
    toast('This browser isn’t saving data, so your stats won’t be kept.');
  }
}

function onEnd(record) {
  recordHand(record);
  render();
  // Let the final discard or Mah Jongg show for a moment before the review.
  setTimeout(() => showEndOfHand(record, session.state, session, {
    onNext: () => session.newHand(),
    onReplay: () => session.replay(),
    extra: hooks.endExtra?.(record, session) ?? null,
  }), 700);
}

function confirmNewHand() {
  if (!session.state || session.state.phase === 'end') return session.newHand();
  openModal('Start a new hand?', [
    h('p', {}, 'The current hand will be abandoned and won’t count.'),
    h('div', { class: 'modal-actions' },
      button('Keep playing', () => closeModal()),
      button('New hand', () => { closeModal(); session.newHand(); }, { variant: 'primary' })),
  ]);
}

/** Settings section: which card to play with (from the next hand). */
function cardChooser() {
  const store = loadCards();
  const options = [[PRACTICE_ID, 'Practice Card (included)'],
    ...store.cards.filter(({ card }) => playableHands(card) > 0).map(({ id, card }) => [id, card.name])];
  const select = h('select', {
    'aria-label': 'Card to play with',
    onchange: async (e) => {
      const id = e.target.value;
      const next = setActive(loadCards(), id);
      if (!saveCards(next)) toast('Couldn’t save your choice in this browser; it applies for this visit only.');
      session.card = id === PRACTICE_ID ? await loadPractice() : getCard(next, id);
      session.cardId = id;
      toast(`“${session.card.name}” will be used from your next hand.`);
    },
  }, ...options.map(([id, name]) => h('option', { value: id, selected: id === store.activeId }, name)));
  return h('section', {},
    h('h3', {}, 'Card'),
    h('div', { class: 'field' }, h('span', {}, 'Play with'), select),
    h('p', { class: 'muted' }, h('a', { href: 'card.html' }, 'Open the card editor'), ' to enter your own card.'));
}

/** Shown when there is no playable card: use the practice card, import a file, or open the editor. */
function showNoCard(problem) {
  const pick = () => {
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const { card, errors, fatal } = importCard(await file.text());
      if (fatal) return toast(fatal);
      if (playableHands(card) === 0) return toast('That card has no playable hands. Open the card editor to fix it.');
      const id = `c-${Date.now().toString(36)}`;
      if (!saveCards(setActive(putCard(loadCards(), id, card), id))) toast('Couldn’t save the card in this browser; playing it for this visit only.');
      const bad = errors.filter((e) => e.index !== null).length;
      if (bad) toast(`Imported. ${bad} hand problem${bad === 1 ? '' : 's'} to fix in the card editor; those hands are skipped.`);
      begin(card);
    });
    document.body.append(input);
    input.click();
  };
  mount(app, h('div', { class: 'no-card' },
    h('h2', {}, 'No card loaded'),
    h('p', {}, problem),
    h('div', { class: 'no-card-actions' },
      button('Play with the practice card', async () => {
        saveCards(setActive(loadCards(), PRACTICE_ID));
        try { begin(await loadPractice()); } catch (e) { toast(e.message); }
      }, { variant: 'primary' }),
      button('Import a card file', pick),
      h('a', { class: 'btn', href: 'card.html' }, 'Open the card editor'))));
}

function begin(card, cardId = loadCards().activeId) {
  app.replaceChildren(layout.top, layout.left, layout.center, layout.right, layout.me, layout.side);
  settings = loadSettings();
  session = new Session({ card, settings, onChange: render, onEnd });
  session.cardId = cardId;
  buildTopbar();
  session.newHand();
}

function buildTopbar() {
  const bar = document.getElementById('topbar-actions');
  mount(bar,
    button('New hand', confirmNewHand),
    button('Card', () => showCard(session.state?.card ?? session.card)),
    hooks.renderSide ? button('Tips', () => { ui.sideOpen = !ui.sideOpen; render(); }) : null,
    button('Settings', () => showSettings(session.settings, {
      onChange: () => { saveSettings(session.settings); render(); },
      extraSections: [cardChooser(), ...(hooks.settingsSections?.(session.settings, render) ?? [])],
    })),
    h('a', { class: 'btn', href: 'stats.html' }, 'Stats'),
    h('a', { class: 'btn', href: 'card.html' }, 'My cards'),
    h('a', { class: 'btn', href: 'learn.html' }, 'Learn'));
}

export async function start() {
  rack = new Rack(rackEl, {
    onChange: render,
    onTapSelected: (tile) => {
      const d = session.observation().decision;
      if (d?.kind === 'turn') humanAct({ type: 'discard', tile });
    },
  });
  mount(rackTools, button('Sort', () => { rack.sort(); rack.render(); }, { title: 'Sort your rack by suit and number' }));
  const { card, problem } = await loadActiveCard();
  if (card) begin(card);
  else showNoCard(problem);
}

// Seat helper for hooks.
export { nameOf };
