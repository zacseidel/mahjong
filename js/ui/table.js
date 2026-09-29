// Rendering the table from the human's observation: opponents, discards, narration, exposures.

import { h, mount } from './dom.js';
import { tileEl, tileRow } from './tileArt.js';
import { nameOf, windOf, narrate, relative, tileName } from './format.js';
import { JOKER } from '../engine/tiles.js';

/** One exposure as tiles (jokers shown as jokers). */
export function exposureEl(e, size = 'sm') {
  const ids = [...Array(e.count - e.jokers).fill(e.tile), ...Array(e.jokers).fill(JOKER)];
  return h('span', { class: 'exposure', title: `${e.count} × ${tileName(e.tile)}` }, tileRow(ids, { size }));
}

/**
 * @param {HTMLElement} el   Opponent panel.
 * @param {Object} obs       Human's observation.
 * @param {number} seat
 * @param {{level: string, badges?: HTMLElement[], onOpen?: () => void}} extra
 */
export function renderOpponent(el, obs, seat, { level, badges = [], onOpen } = {}) {
  const human = obs.seat;
  const isTurn = obs.turnSeat === seat;
  const count = obs.concealedCounts[seat];
  const backs = h('span', { class: 'backs', 'aria-label': `${count} concealed tiles` },
    ...Array.from({ length: count }, () => tileEl(0, { size: 'xs', back: true })));
  el.classList.toggle('is-turn', isTurn);
  el.classList.toggle('is-dead', obs.dead[seat]);
  mount(el,
    h('button', { type: 'button', class: 'opp-head', onclick: onOpen, 'aria-label': `${nameOf(seat, human)} details` },
      h('span', { class: 'opp-name' }, nameOf(seat, human)),
      h('span', { class: 'wind-badge' }, windOf(seat, obs.dealer)),
      h('span', { class: 'level' }, level),
      obs.dead[seat] ? h('span', { class: 'badge badge-dead' }, 'Dead') : null,
      ...badges),
    h('div', { class: 'opp-backs' }, backs, h('span', { class: 'count' }, `${count}`)),
    h('div', { class: 'exposures' }, ...obs.exposures[seat].map((e) => exposureEl(e, 'sm'))),
  );
}

/** The center: latest discard, status, full discard history, recent narration. */
export function renderCenter(el, obs, { thinking }) {
  const human = obs.seat;
  const last = obs.discardHistory.at(-1);
  const latest = last
    ? h('div', { class: 'latest' },
      tileEl(last.tile, { size: 'lg', className: last.called ? 'is-called' : '' }),
      h('div', { class: 'latest-caption' },
        h('strong', {}, tileName(last.tile)),
        h('span', {}, `${nameOf(last.seat, human) === 'You' ? 'You' : nameOf(last.seat, human)} discarded${last.called ? ' · called' : ''}`)))
    : h('div', { class: 'latest empty' }, h('span', {}, obs.phase === 'charleston' ? 'Charleston' : 'No discards yet'));

  let status;
  if (obs.phase === 'end') status = 'Hand over';
  else if (obs.phase === 'charleston') status = 'Charleston';
  else if (obs.turnSeat === human) status = 'Your turn';
  else if (obs.turnSeat !== null) status = `${nameOf(obs.turnSeat, human)}’s turn${thinking ? '…' : ''}`;
  else status = 'Waiting for calls…';

  const history = h('div', { class: 'history', 'aria-label': 'Discard history' },
    ...obs.discardHistory.map((d) => {
      const t = tileEl(d.tile, { size: 'xs', className: `rel-${relative(d.seat, human)}${d.called ? ' is-called' : ''}` });
      t.title = `${tileName(d.tile)} — ${nameOf(d.seat, human)}${d.called ? ' (called)' : ''}`;
      return t;
    }));

  const lines = obs.log.map((e) => narrate(e, human)).filter(Boolean).slice(-5);
  mount(el,
    h('div', { class: 'center-top' },
      latest,
      h('div', { class: 'status' },
        h('div', { class: 'status-main' }, status),
        h('div', { class: 'status-sub' }, `Wall: ${obs.wallCount} · Discards: ${obs.discardHistory.length}`))),
    history,
    h('ol', { class: 'narration', 'aria-live': 'polite' }, ...lines.map((l) => h('li', {}, l))),
  );
}

/** The human's exposures. */
export function renderMyExposures(el, obs) {
  mount(el, ...obs.exposures[obs.seat].map((e) => exposureEl(e, 'md')));
}
