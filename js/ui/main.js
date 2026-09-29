// Game page bootstrap: load the card, build the table, and wire the session to the UI.

import { h, mount, button } from './dom.js';
import { Rack } from './rack.js';
import { Session, defaultSettings } from './session.js';
import { renderOpponent, renderCenter, renderMyExposures } from './table.js';
import { renderPrompt } from './prompt.js';
import { showEndOfHand, showCard, showSettings, showOpponent, openModal, closeModal } from './modals.js';
import { nameOf, windOf } from './format.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

async function loadCard() {
  const res = await fetch('data/practice-card.json');
  if (!res.ok) throw new Error(`Could not load the practice card (${res.status})`);
  return res.json();
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
  hooks.onHumanAction?.(obs, action);
  const error = session.act(action);
  if (error) toast(error);
  else rack.clearSelection();
}

function onEnd(record) {
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

function buildTopbar() {
  const bar = document.getElementById('topbar-actions');
  mount(bar,
    button('New hand', confirmNewHand),
    button('Card', () => showCard(session.card)),
    hooks.renderSide ? button('Tips', () => { ui.sideOpen = !ui.sideOpen; render(); }) : null,
    button('Settings', () => showSettings(session.settings, {
      onChange: render,
      extraSections: hooks.settingsSections?.(session.settings, render) ?? [],
    })),
    h('a', { class: 'btn', href: 'learn.html' }, 'Learn'));
}

export async function start() {
  app.replaceChildren(layout.top, layout.left, layout.center, layout.right, layout.me, layout.side);
  rack = new Rack(rackEl, {
    onChange: render,
    onTapSelected: (tile) => {
      const d = session.observation().decision;
      if (d?.kind === 'turn') humanAct({ type: 'discard', tile });
    },
  });
  mount(rackTools, button('Sort', () => { rack.sort(); rack.render(); }, { title: 'Sort your rack by suit and number' }));
  let card;
  try {
    card = await loadCard();
  } catch (e) {
    mount(app, h('div', { class: 'no-card' },
      h('h2', {}, 'No card loaded'),
      h('p', {}, e.message),
      h('p', {}, 'If you opened this file directly, serve the folder instead (for example: python3 -m http.server 8000).')));
    return;
  }
  session = new Session({ card, settings: defaultSettings(), onChange: render, onEnd });
  buildTopbar();
  session.newHand();
}

// Seat helper for hooks.
export { nameOf };
