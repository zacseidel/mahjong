// The decision panel above the rack: Charleston passes, votes, courtesy, turn actions, claims.
// It only offers what the engine's pending decision allows; the engine still validates.

import { h, mount, button } from './dom.js';
import { nameOf, groupName, tileName } from './format.js';
import { passTarget } from '../engine/charleston.js';
import { acrossOf } from '../engine/seats.js';
import { tileEl } from './tileArt.js';

/**
 * Render the prompt for the human's pending decision, and set the rack's selection mode.
 * @param {HTMLElement} el
 * @param {Object} obs
 * @param {import('./rack.js').Rack} rack
 * @param {{act: (action: Object) => void, ui: Object, rerender: () => void, thinking: boolean}} ctx
 */
export function renderPrompt(el, obs, rack, ctx) {
  const d = obs.decision;
  const human = obs.seat;
  const ui = ctx.ui;
  if (!d) {
    rack.setMode(0);
    let msg = obs.phase === 'end' ? 'Hand over.' : 'Waiting for the other players…';
    if (obs.phase === 'charleston') msg = 'Waiting for the other players to pass…';
    else if (obs.turnSeat !== null && obs.turnSeat !== human) msg = `${nameOf(obs.turnSeat, human)} is playing…`;
    mount(el, h('p', { class: 'prompt-msg' }, msg));
    return;
  }

  switch (d.kind) {
    case 'pass': {
      const blind = d.blindAllowed ? ui.blind ?? 0 : 0;
      const need = 3 - blind;
      rack.setMode(need);
      const to = nameOf(passTarget(human, d.direction), human);
      const chosen = rack.selectedTiles();
      const title = `Charleston ${d.round < 3 ? 1 : 2}: pass 3 tiles ${d.direction} (to ${to})`;
      const blindPicker = d.blindAllowed
        ? h('div', { class: 'blind' },
          h('span', {}, 'Blind pass — send on unseen tiles coming to you:'),
          ...[0, 1, 2, 3].map((k) => button(String(k), () => { ui.blind = k; rack.clearSelection(); ctx.rerender(); },
            { variant: k === blind ? 'is-on' : '' })))
        : null;
      mount(el,
        h('div', { class: 'prompt-title' }, title),
        blindPicker,
        h('div', { class: 'prompt-row' },
          h('span', { class: 'prompt-hint' }, need ? `Select ${need} tile${need > 1 ? 's' : ''} (${chosen.length}/${need}). Jokers can’t be passed.` : 'Passing 3 unseen tiles.'),
          button('Pass', () => { ctx.act({ type: 'pass', tiles: chosen, blind }); ui.blind = 0; }, { variant: 'primary', disabled: chosen.length !== need })));
      return;
    }
    case 'vote':
      rack.setMode(0);
      mount(el,
        h('div', { class: 'prompt-title' }, 'First Charleston done. Play the optional second Charleston?'),
        h('div', { class: 'prompt-row' },
          h('span', { class: 'prompt-hint' }, 'Anyone can stop it. Stop if your hand is shaping up well.'),
          button('Continue', () => ctx.act({ type: 'vote', stop: false }), { variant: 'primary' }),
          button('Stop', () => ctx.act({ type: 'vote', stop: true }))));
      return;
    case 'courtesyRequest':
      rack.setMode(0);
      mount(el,
        h('div', { class: 'prompt-title' }, `Courtesy pass with ${nameOf(acrossOf(human), human)} (across): how many tiles?`),
        h('div', { class: 'prompt-row' },
          h('span', { class: 'prompt-hint' }, 'You trade the smaller number either of you asks for.'),
          ...[0, 1, 2, 3].map((k) => button(String(k), () => ctx.act({ type: 'courtesyRequest', count: k }), { variant: 'primary' }))));
      return;
    case 'courtesyPass': {
      rack.setMode(d.count);
      const chosen = rack.selectedTiles();
      mount(el,
        h('div', { class: 'prompt-title' }, `Courtesy pass: choose ${d.count} tile${d.count > 1 ? 's' : ''} for ${nameOf(acrossOf(human), human)}`),
        h('div', { class: 'prompt-row' },
          h('span', { class: 'prompt-hint' }, `${chosen.length}/${d.count} selected. Jokers can’t be passed.`),
          button('Pass', () => ctx.act({ type: 'courtesyPass', tiles: chosen }), { variant: 'primary', disabled: chosen.length !== d.count })));
      return;
    }
    case 'turn': {
      rack.setMode(1, 'discard');
      const [sel] = rack.selectedTiles();
      const drew = obs.drawn !== null ? `You drew ${tileName(obs.drawn)}. ` : '';
      const lead = d.afterCall ? 'Your exposure is on the table. Now discard.' : `${drew}Discard a tile (tap it, then tap again or press Discard).`;
      mount(el,
        h('div', { class: 'prompt-title' }, 'Your turn'),
        h('div', { class: 'prompt-row' },
          h('span', { class: 'prompt-hint' }, lead),
          button(sel === undefined ? 'Discard' : `Discard ${tileName(sel)}`, () => ctx.act({ type: 'discard', tile: sel }), { variant: 'primary', disabled: sel === undefined }),
          button('Mah Jongg!', () => ctx.act({ type: 'mahjong' }), {
            variant: d.mahJongg ? 'primary mahjong' : 'mahjong',
            disabled: !d.canDeclareMahJongg,
            title: obs.trainingWheels ? 'Enabled when your hand matches the card' : 'Training wheels off: a false Mah Jongg has a penalty',
          })),
        d.exchanges.length ? h('div', { class: 'prompt-row exchanges' },
          h('span', { class: 'prompt-hint' }, 'Joker exchanges:'),
          ...d.exchanges.map((x) => button(`Swap your ${tileName(x.tile)} for ${x.seat === human ? 'your' : `${nameOf(x.seat, human)}’s`} joker`,
            () => ctx.act({ type: 'exchange', seat: x.seat, index: x.index })))) : null,
        d.deadTargets.length ? h('div', { class: 'prompt-row alert' },
          ...d.deadTargets.map((t) => h('span', {}, `${nameOf(t, human)}’s exposures don’t match any hand on your card.`)),
          ...d.deadTargets.map((t) => button(`Declare ${nameOf(t, human)} dead`, () => ctx.act({ type: 'declareDead', target: t })))) : null,
      );
      return;
    }
    case 'claim': {
      rack.setMode(0);
      const who = nameOf(d.discarder, human);
      const buttons = [];
      for (const o of d.options) {
        if (o.type === 'mahjong') {
          buttons.push(button('Mah Jongg!', () => ctx.act({ type: 'claim', call: 'mahjong' }), { variant: 'primary mahjong' }));
        } else {
          const key = `${o.count}`;
          const jokers = Math.min(o.maxJokers, Math.max(o.minJokers, ui.claimJokers?.[key] ?? o.minJokers));
          const stepper = o.maxJokers > o.minJokers
            ? h('span', { class: 'stepper' },
              button('−', () => { ui.claimJokers = { ...ui.claimJokers, [key]: jokers - 1 }; ctx.rerender(); }, { disabled: jokers <= o.minJokers }),
              h('span', {}, `${jokers} joker${jokers === 1 ? '' : 's'}`),
              button('+', () => { ui.claimJokers = { ...ui.claimJokers, [key]: jokers + 1 }; ctx.rerender(); }, { disabled: jokers >= o.maxJokers }))
            : h('span', { class: 'prompt-hint' }, jokers ? `uses ${jokers} joker${jokers > 1 ? 's' : ''}` : '');
          buttons.push(h('span', { class: 'claim-opt' },
            button(`Call ${groupName(o.count)}`, () => { ctx.act({ type: 'claim', call: 'expose', count: o.count, jokers }); ui.claimJokers = {}; }, { variant: 'primary' }),
            stepper));
        }
      }
      mount(el,
        h('div', { class: 'prompt-title claim-title' }, tileEl(d.tile, { size: 'sm' }), ` ${who} discarded ${tileName(d.tile)}. Call it?`),
        h('div', { class: 'prompt-row' }, ...buttons, button('Pass', () => ctx.act({ type: 'claim', call: 'pass' }))));
      return;
    }
    default:
      mount(el, h('p', {}, `Unknown decision: ${d.kind}`));
  }
}
