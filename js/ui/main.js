// Game page bootstrap: load the card, build the table, and wire the session to the UI.

import { h, mount, button } from './dom.js';
import { Rack } from './rack.js';
import { Session } from './session.js';
import { renderOpponent, renderCenter, renderMyExposures } from './table.js';
import { renderPrompt, actionKey } from './prompt.js';
import { showEndOfHand, showCard, showSettings, showOpponent, openModal, closeModal } from './modals.js';
import { nameOf, windOf } from './format.js';
import { loadCards, saveCards, loadSettings, saveSettings, loadLedger, saveLedger, loadFlags, setFlag } from '../storage.js';
import { makeRecord, appendRecord } from '../ledger.js';
import { TUTORIAL, requiredAction, lessonNote } from '../engine/tutorial.js';
import { sameAction, describeAction } from '../engine/actions.js';
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
  coach: null,          // (obs, session, ui, rack, rerender) => HTMLElement|null — shown in the decision panel
  getSettings: () => session?.settings,
};

let session;
let rack;
let settings;
const sessionId = new Date().toISOString();
let handTipsOn = false;
let ledgerWarned = false;
let lastState = null;
/** The guided hand, when active: notes seen, and what it set aside to restore afterward. */
let tutorial = null;
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
    tutorial ? h('span', { class: 'badge badge-guide' }, 'Guided hand') : null,
    obs.dead[human] ? h('span', { class: 'badge badge-dead' }, 'Dead') : null,
    h('span', { class: 'score' }, `Session: ${session.totals[human] >= 0 ? '+' : ''}${session.totals[human]}`));
  layout.me.classList.toggle('is-turn', obs.turnSeat === human);
  renderMyExposures(myExposures, obs);
  rack.sync(obs.hand);
  // "Show me" highlights last only for the decision they were made for.
  const key = `${obs.log.length}:${obs.decision?.kind ?? ''}`;
  if (ui.showMe && ui.showMe.key !== key) ui.showMe = null;
  // Guided hand: the required move is highlighted, and a lesson note may explain the moment.
  let required = null;
  ui.tutorial = null;
  if (tutorial && obs.decision && obs.phase !== 'end') {
    required = requiredAction(obs);
    const note = lessonNote(obs, tutorial.seen, { nameOf: (s) => nameOf(s, human) });
    ui.tutorial = { required, note, dismiss: () => { if (note) tutorial.seen.add(note.id); render(); } };
    ui.showMe = { key, action: required };
    if (ui.tutorialKey !== key) {
      ui.tutorialKey = key;
      if (required?.type === 'pass') ui.blind = required.blind ?? 0;
    }
  }
  renderPrompt(promptEl, obs, rack, { act: humanAct, ui, rerender: render, thinking });
  const coachEl = hooks.coach?.(obs, session, ui, rack, render);
  if (coachEl) promptEl.firstChild ? promptEl.firstChild.after(coachEl) : promptEl.append(coachEl);
  if (ui.showMe) promptEl.querySelector(`[data-act="${actionKey(ui.showMe.action)}"]`)?.classList.add('is-suggested');
  rack.highlight = new Set();
  rack.marks = new Map();
  hooks.decorate?.(obs, rack, ui);
  rackEl.classList.toggle('guided', !!required);
  rack.highlightUids = new Set();
  if (required && ['pass', 'courtesyPass', 'discard'].includes(required.type)) {
    rack.highlight = new Set();
    rack.highlightExactly(required.type === 'discard' ? [required.tile] : required.tiles);
  }
  rack.render();
  if (hooks.renderSide && ui.sideOpen) hooks.renderSide(layout.side, obs, session, ui, render, humanAct);
  app.classList.toggle('side-closed', !ui.sideOpen || !hooks.renderSide);
}

function humanAct(action) {
  const obs = session.observation();
  if (tutorial && obs.phase !== 'end') {
    const required = requiredAction(obs);
    if (required && !sameAction(action, required)) {
      toast(`In the guided hand, make the suggested move: ${describeAction(required)}.`);
      return;
    }
    if (ui.tutorial?.note) tutorial.seen.add(ui.tutorial.note.id);
  }
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
  const guided = !!tutorial;
  if (!guided) recordHand(record); // the guided hand isn't a real hand; keep it out of stats
  render();
  const outro = guided ? h('section', { class: 'lesson' },
    h('h3', {}, 'You finished the guided hand!'),
    h('p', {}, 'You passed tiles in the Charleston (including blind passes), called discards to expose groups, swapped a real tile for a joker, watched an opponent’s exposure, and won with a tile you drew yourself.'),
    h('p', {}, 'Next, play a real hand. The coach still explains each step and suggests moves, but the choices are yours. Replay the guided hand any time from the top bar.')) : null;
  // Let the final discard or Mah Jongg show for a moment before the review.
  setTimeout(() => showEndOfHand(record, session.state, session, {
    onNext: () => { exitTutorial(); session.newHand(); },
    onReplay: () => (guided ? startTutorial() : session.replay()),
    extra: h('div', {}, outro, hooks.endExtra?.(record, session) ?? null),
  }), 700);
}

/** Start (or restart) the guided first hand. */
async function startTutorial() {
  closeModal();
  let practice;
  try {
    practice = await loadPractice();
  } catch (e) {
    return toast(e.message);
  }
  if (!tutorial) {
    tutorial = { saved: { settings: session.settings, card: session.card, cardId: session.cardId, totals: session.totals.slice(), nextDealer: session.nextDealer } };
  }
  tutorial.seen = new Set();
  session.settings = {
    ...settings,
    humanSeat: TUTORIAL.human,
    levels: [...TUTORIAL.levels],
    trainingWheels: true,
    rules: {},
    tips: { offense: true, defense: true },
    explain: true,
    speed: settings.speed === 'instant' ? 'normal' : settings.speed,
  };
  session.card = practice;
  session.cardId = PRACTICE_ID;
  session.newHand({ seed: TUTORIAL.seed, dealer: TUTORIAL.dealer });
}

/** Leave the guided hand and restore the player's own settings, card, and totals. */
function exitTutorial() {
  if (!tutorial) return;
  const s = tutorial.saved;
  Object.assign(session, { settings: s.settings, card: s.card, cardId: s.cardId, totals: s.totals, nextDealer: s.nextDealer });
  tutorial = null;
}

function confirmTutorial() {
  if (!session.state || session.state.phase === 'end' || tutorial) return startTutorial();
  openModal('Start the guided hand?', [
    h('p', {}, 'A short hand where the coach walks you through every step. The current hand will be abandoned and won’t count.'),
    h('div', { class: 'modal-actions' },
      button('Keep playing', () => closeModal()),
      button('Start the guided hand', startTutorial, { variant: 'primary' })),
  ]);
}

function confirmNewHand() {
  const fresh = () => { exitTutorial(); session.newHand(); };
  if (!session.state || session.state.phase === 'end') return fresh();
  openModal(tutorial ? 'Leave the guided hand?' : 'Start a new hand?', [
    h('p', {}, tutorial ? 'You can come back to it any time with Guided hand.' : 'The current hand will be abandoned and won’t count.'),
    h('div', { class: 'modal-actions' },
      button('Keep playing', () => closeModal()),
      button('New hand', () => { closeModal(); fresh(); }, { variant: 'primary' })),
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
  if (location.hash === '#tutorial') {
    setFlag('welcomed');
    startTutorial();
  } else if (!loadFlags().welcomed) showWelcome();
  buildTopbar();
  session.newHand();
}

/** First visit: what the game is and how this site teaches it. */
function showWelcome() {
  setFlag('welcomed');
  openModal('Welcome!', [
    h('p', {}, 'You’re about to play American mah jongg against three computer players. The goal: be first to collect 14 tiles that exactly match one hand on the card.'),
    h('ul', {},
      h('li', {}, h('strong', {}, 'The card. '), 'Tap Card at the top any time to see every hand you can make.'),
      h('li', {}, h('strong', {}, 'The coach. '), 'Above your tiles, “How this works” explains each step, and the Tip suggests a move. Tap Why? for the reason, or Show me to see it on your tiles.'),
      h('li', {}, h('strong', {}, 'Words. '), 'Underlined words like pung or exposure: tap them for a quick definition.'),
      h('li', {}, h('strong', {}, 'Tips panel. '), 'Your closest hands, laid out tile by tile, and which of your tiles are risky to throw. On a smaller screen, tap Tips to open it.'),
      h('li', {}, h('strong', {}, 'After each hand. '), 'See how the hand was won and compare your choices with the tips.')),
    h('p', {}, 'New to the game? Start with the ', h('strong', {}, 'guided hand'), ': a short hand where the coach walks you through every step, from the Charleston to Mah Jongg. The ', h('a', { href: 'learn.html' }, 'Learn page'), ' covers the rules in about ten minutes. Your opponents start at Beginner.'),
    h('div', { class: 'modal-actions' },
      button('Just play', closeModal),
      button('Take the guided hand', startTutorial, { variant: 'primary' })),
  ]);
}

function buildTopbar() {
  const bar = document.getElementById('topbar-actions');
  mount(bar,
    button('New hand', confirmNewHand),
    button('Guided hand', confirmTutorial, { title: 'A short hand where the coach walks you through every step' }),
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

// Debugging aid: with ?debug in the URL, expose the session for the browser console.
if (new URLSearchParams(location.search).has('debug')) {
  window.__mj = { get session() { return session; }, get tutorial() { return tutorial; } };
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
