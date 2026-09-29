// learn.html: render tile examples and card lines.
import { tileRow } from './tileArt.js';
import { cardLine } from './format.js';
import { parseTiles } from '../engine/tiles.js';

for (const el of document.querySelectorAll('[data-tiles]')) {
  el.replaceWith(tileRow(parseTiles(el.dataset.tiles), { size: 'md' }));
}
for (const el of document.querySelectorAll('[data-line]')) {
  el.replaceWith(cardLine(el.dataset.line));
}
