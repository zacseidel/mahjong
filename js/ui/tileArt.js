// Original SVG tile art, generated in code (SPEC §13.3). Each suit has its own shape as well as
// its own color, so color is never the only signal.

import { isNumber, isWind, isDragon, isFlower, isJoker, suitOf, rankOf, displayName, CRAK, BAM } from '../engine/tiles.js';

const INK = {
  crak: 'var(--ink-crak)',
  bam: 'var(--ink-bam)',
  dot: 'var(--ink-dot)',
  wind: 'var(--ink-wind)',
  flower: 'var(--ink-flower)',
  joker: 'var(--ink-joker)',
};

const FRAME = '<rect x="2" y="2" width="56" height="76" rx="8" class="tile-face"/>';

function label(text, color, y = 74) {
  return `<text x="30" y="${y}" text-anchor="middle" font-size="8.5" font-weight="700" letter-spacing="0.5" fill="${color}">${text}</text>`;
}

function big(text, color, y = 38, size = 32) {
  return `<text x="30" y="${y}" text-anchor="middle" font-size="${size}" font-weight="800" fill="${color}">${text}</text>`;
}

function suitMark(suit) {
  if (suit === CRAK) {
    const c = INK.crak;
    return `<path d="M30 42 L41 53 L30 64 L19 53 Z" fill="none" stroke="${c}" stroke-width="3"/>`
      + `<path d="M25 53 H35 M30 48 V58" stroke="${c}" stroke-width="2.5"/>`;
  }
  if (suit === BAM) {
    const c = INK.bam;
    return `<rect x="25" y="41" width="10" height="24" rx="4" fill="${c}"/>`
      + '<path d="M25 49 H35 M25 57 H35" stroke="var(--tile-face)" stroke-width="1.6"/>';
  }
  const c = INK.dot;
  return `<circle cx="30" cy="53" r="10" fill="none" stroke="${c}" stroke-width="3.5"/><circle cx="30" cy="53" r="3.5" fill="${c}"/>`;
}

const SUIT_WORD = ['CRAK', 'BAM', 'DOT'];
const SUIT_INK = [INK.crak, INK.bam, INK.dot];
const WIND_LETTER = { 27: 'N', 28: 'E', 29: 'W', 30: 'S' };

function dragon(id) {
  if (id === 31) {
    return big('R', INK.crak, 44, 30)
      + `<rect x="12" y="14" width="36" height="40" rx="6" fill="none" stroke="${INK.crak}" stroke-width="3"/>` + label('DRAGON', INK.crak, 70);
  }
  if (id === 32) {
    return big('G', INK.bam, 44, 30)
      + `<rect x="12" y="14" width="36" height="40" rx="6" fill="none" stroke="${INK.bam}" stroke-width="3"/>` + label('DRAGON', INK.bam, 70);
  }
  // White dragon: the traditional blue frame; also used as zero.
  return `<rect x="11" y="12" width="38" height="46" rx="3" fill="none" stroke="${INK.dot}" stroke-width="3"/>`
    + `<rect x="16" y="17" width="28" height="36" rx="2" fill="none" stroke="${INK.dot}" stroke-width="1.5"/>`
    + big('0', INK.dot, 43, 20) + label('SOAP', INK.dot, 70);
}

function flower() {
  const c = INK.flower;
  let petals = '';
  for (let k = 0; k < 5; k++) {
    const a = (k * 72 - 90) * (Math.PI / 180);
    petals += `<circle cx="${(30 + 10 * Math.cos(a)).toFixed(1)}" cy="${(36 + 10 * Math.sin(a)).toFixed(1)}" r="7.5" fill="${c}" opacity="0.85"/>`;
  }
  return petals + '<circle cx="30" cy="36" r="5" fill="var(--ink-gold)"/>' + label('FLOWER', c, 70);
}

function joker() {
  const c = INK.joker;
  const star = 'M30 14 L34.5 26 L47 26 L37 34 L41 47 L30 39 L19 47 L23 34 L13 26 L25.5 26 Z';
  return `<path d="${star}" fill="var(--ink-gold)" stroke="${c}" stroke-width="1.5"/>` + big('J', c, 64, 18) + label('JOKER', c, 74);
}

/**
 * SVG markup for a tile face (or its back).
 * @param {number} id
 * @param {{back?: boolean}} [options]
 * @returns {string}
 */
export function tileSVG(id, { back = false } = {}) {
  let body;
  if (back) {
    body = '<rect x="2" y="2" width="56" height="76" rx="8" class="tile-back"/>'
      + '<rect x="9" y="9" width="42" height="62" rx="5" fill="none" stroke="var(--tile-back-line)" stroke-width="2"/>';
    return `<svg viewBox="0 0 60 80" aria-hidden="true">${body}</svg>`;
  }
  if (isNumber(id)) {
    const s = suitOf(id);
    body = FRAME + big(String(rankOf(id)), SUIT_INK[s], 34, 30) + suitMark(s) + label(SUIT_WORD[s], SUIT_INK[s], 76);
  } else if (isWind(id)) {
    body = FRAME + big(WIND_LETTER[id], INK.wind, 46, 38) + label('WIND', INK.wind, 70);
  } else if (isDragon(id)) {
    body = FRAME + dragon(id);
  } else if (isFlower(id)) {
    body = FRAME + flower();
  } else if (isJoker(id)) {
    body = FRAME + joker();
  } else {
    throw new RangeError(`Not a tile id: ${id}`);
  }
  return `<svg viewBox="0 0 60 80" aria-hidden="true">${body}</svg>`;
}

/**
 * A tile element. Buttons for interactive tiles, spans otherwise.
 * @param {number} id
 * @param {{size?: 'xs'|'sm'|'md'|'lg', back?: boolean, button?: boolean, className?: string}} [options]
 * @returns {HTMLElement}
 */
export function tileEl(id, { size = 'md', back = false, button = false, className = '' } = {}) {
  const el = document.createElement(button ? 'button' : 'span');
  el.className = `tile tile-${size}${back ? ' is-back' : ''}${className ? ` ${className}` : ''}`;
  if (button) el.type = 'button';
  el.innerHTML = tileSVG(id, { back });
  const name = back ? 'Hidden tile' : displayName(id);
  el.setAttribute('aria-label', name);
  if (!button) {
    el.setAttribute('role', 'img');
    el.title = name;
  }
  return el;
}

/**
 * A row of tiles.
 * @param {number[]} ids
 * @param {Object} [options]  Passed to tileEl.
 */
export function tileRow(ids, options = {}) {
  const row = document.createElement('span');
  row.className = 'tile-row';
  for (const id of ids) row.append(tileEl(id, options));
  return row;
}
