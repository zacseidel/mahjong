// Tappable glossary terms: text with mah jongg terms underlined; tap one for its definition.

import { h } from './dom.js';
import { GLOSSARY, splitTerms } from '../glossary.js';

let popover = null;

function closePopover() {
  popover?.remove();
  popover = null;
}

document.addEventListener('click', (e) => {
  if (popover && !e.target.closest('.term') && !e.target.closest('.term-pop')) closePopover();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });

function showDefinition(button, key) {
  const wasOpen = popover?.dataset.key === key;
  closePopover();
  if (wasOpen) return;
  const r = button.getBoundingClientRect();
  popover = h('div', { class: 'term-pop', role: 'tooltip', 'data-key': key },
    h('strong', {}, button.textContent), ' ', GLOSSARY[key].text);
  document.body.append(popover);
  const w = popover.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 8 + popover.offsetHeight < window.innerHeight;
  popover.style.left = `${left}px`;
  popover.style.top = `${below ? r.bottom + 6 : r.top - popover.offsetHeight - 6}px`;
}

/**
 * Text with glossary terms made tappable. Pass the same `seen` set to several calls so each
 * term is marked only once in a block.
 * @param {string} text
 * @param {Set<string>} [seen]
 * @returns {DocumentFragment}
 */
export function richText(text, seen = new Set()) {
  const frag = document.createDocumentFragment();
  for (const part of splitTerms(text, seen)) {
    if (!part.term) {
      frag.append(part.text);
      continue;
    }
    const b = h('button', { type: 'button', class: 'term', 'aria-label': `${part.text}: what’s this?` }, part.text);
    b.addEventListener('click', (e) => { e.stopPropagation(); showDefinition(b, part.term); });
    frag.append(b);
  }
  return frag;
}
