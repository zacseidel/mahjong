// card.html: the user's card library and hand editor (SPEC §12).
// Cards live only in this browser (storage.js) and in files the user exports.

import { h, mount, button } from './dom.js';
import { tileRow } from './tileArt.js';
import { cardLine } from './format.js';
import { openModal, closeModal } from './modals.js';
import { loadCards, saveCards, storageAvailable, loadFlags, setFlag } from '../storage.js';
import {
  PRACTICE_ID, CATEGORY_SUGGESTIONS, blankCard, getCard, putCard, removeCard, setActive, copyOfCard,
  addHand, updateHand, removeHand, duplicateHand, moveHand, exportCard, exportFileName, importCard, previewHand,
} from '../cardStore.js';
import { validateCard } from '../engine/card.js';

const root = document.getElementById('editor');
const toastEl = document.getElementById('toast');

let store = loadCards();
let practice = null;
let selectedId = store.activeId;
const canSave = storageAvailable();

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

function newId() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `c-${a[0].toString(36)}${a[1].toString(36)}`;
}

function commit(next, message) {
  store = next;
  if (!saveCards(store)) toast('Couldn’t save in this browser. Export your card to keep it.');
  else if (message) toast(message);
  render();
}

const selectedCard = () => (selectedId === PRACTICE_ID ? practice : getCard(store, selectedId));
const readOnly = () => selectedId === PRACTICE_ID;

function updateSelected(fn, message) {
  commit(putCard(store, selectedId, fn(selectedCard())), message);
}

// ---------- Files ----------

function download(card) {
  const blob = new Blob([exportCard(card)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: exportFileName(card) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile() {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const { card, errors, fatal } = importCard(await file.text());
    if (fatal) {
      openModal('Couldn’t import that file', [h('p', {}, fatal), h('div', { class: 'modal-actions' }, button('OK', closeModal, { variant: 'primary' }))]);
      return;
    }
    const id = newId();
    selectedId = id;
    commit(putCard(store, id, card));
    showImportReport(card, errors);
  });
  document.body.append(input);
  input.click();
}

function showImportReport(card, errors) {
  const bad = errors.filter((e) => e.index !== null);
  openModal('Card imported', [
    h('p', {}, `“${card.name}”: ${card.hands.length} hand${card.hands.length === 1 ? '' : 's'}.`),
    bad.length
      ? h('div', {},
        h('p', {}, `${bad.length} problem${bad.length === 1 ? '' : 's'} to fix. These hands are kept so you can correct them; the game skips them until then.`),
        h('ul', { class: 'problems' }, ...bad.map((e) => h('li', {}, `Hand ${e.index + 1}${e.id ? ` (${e.id})` : ''}: ${e.message}`))))
      : h('p', {}, 'Every hand checked out.'),
    h('div', { class: 'modal-actions' }, button('OK', closeModal, { variant: 'primary' })),
  ]);
}

// ---------- Card-level actions ----------

function newCardDialog() {
  const name = h('input', { type: 'text', value: 'My card', 'aria-label': 'Card name', required: true });
  const year = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'e.g. 2026', 'aria-label': 'Year' });
  openModal('New card', [
    h('label', { class: 'field-stack' }, h('span', {}, 'Name'), name),
    h('label', { class: 'field-stack' }, h('span', {}, 'Year (optional)'), year),
    h('div', { class: 'modal-actions' },
      button('Cancel', closeModal),
      button('Create', () => {
        const id = newId();
        selectedId = id;
        closeModal();
        commit(putCard(store, id, blankCard(name.value.trim() || 'My card', Number.parseInt(year.value, 10) || null)), 'Card created. Add its hands one at a time.');
      }, { variant: 'primary' })),
  ]);
  name.select();
}

function confirmDialog(title, text, action, verb = 'Delete') {
  openModal(title, [
    h('p', {}, text),
    h('div', { class: 'modal-actions' },
      button('Cancel', closeModal),
      button(verb, () => { closeModal(); action(); }, { variant: 'primary' })),
  ]);
}

// ---------- Hand form ----------

function handForm(index) {
  const card = selectedCard();
  const existing = index >= 0 ? card.hands[index] : null;
  const draft = existing ? structuredClone(existing) : { category: '', line: '', numbers: 'fixed', value: 25, concealed: false, notes: '' };

  const category = h('input', { type: 'text', list: 'categories', value: draft.category, 'aria-label': 'Category' });
  const line = h('input', { type: 'text', class: 'line-input', value: draft.line, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Hand line' });
  const numbers = h('select', { 'aria-label': 'Numbers' },
    h('option', { value: 'fixed', selected: draft.numbers === 'fixed' }, 'Exactly as printed'),
    h('option', { value: 'shift', selected: draft.numbers === 'shift' }, 'Any: all numbers move together (like numbers, consecutive)'));
  const concealed = h('select', { 'aria-label': 'Exposed or concealed' },
    h('option', { value: 'X', selected: !draft.concealed }, 'X — exposed'),
    h('option', { value: 'C', selected: draft.concealed }, 'C — concealed'));
  const value = h('input', { type: 'number', inputmode: 'numeric', min: '1', step: '1', value: String(draft.value ?? ''), 'aria-label': 'Value' });
  const notes = h('input', { type: 'text', value: draft.notes ?? '', 'aria-label': 'Notes', placeholder: 'e.g. Any 3 consecutive numbers' });
  const advanced = h('textarea', { rows: '7', spellcheck: 'false', 'aria-label': 'Advanced pattern JSON' });
  advanced.value = draft.pattern ? JSON.stringify(draft.pattern, null, 2) : '';
  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });

  function current() {
    let pattern;
    let patternError = null;
    const text = advanced.value.trim();
    if (text) {
      try { pattern = JSON.parse(text); } catch { patternError = 'The advanced pattern isn’t valid JSON.'; }
    }
    return {
      hand: {
        ...(existing ? { id: existing.id } : {}),
        category: category.value,
        line: line.value,
        numbers: numbers.value,
        value: value.value === '' ? NaN : Number(value.value),
        concealed: concealed.value === 'C',
        notes: notes.value,
        ...(pattern ? { pattern } : {}),
      },
      patternError,
    };
  }

  function update() {
    const { hand, patternError } = current();
    if (patternError) return mount(preview, h('p', { class: 'error' }, patternError));
    if (!hand.line.trim() && !hand.pattern) return mount(preview, h('p', { class: 'muted' }, 'Type the hand as printed. The preview shows example tiles as you go.'));
    const p = previewHand(hand);
    if (!p.ok) {
      const caret = p.pos === null || hand.pattern ? null
        : h('pre', { class: 'caret', 'aria-hidden': 'true' }, `${hand.line}\n${' '.repeat(p.pos)}^`);
      return mount(preview, h('p', { class: 'error' }, p.error), caret);
    }
    mount(preview,
      h('p', { class: 'muted' }, `${p.total} way${p.total === 1 ? '' : 's'} to make this hand. For example:`),
      ...p.examples.map((ex) => h('div', { class: 'example' }, tileRow(ex.layout.flatMap(({ tile, count }) => Array(count).fill(tile)), { size: 'sm' }), h('span', { class: 'muted' }, ex.text))),
      !Number.isInteger(hand.value) || hand.value <= 0 ? h('p', { class: 'error' }, 'Enter a value (points).') : null);
  }
  for (const el of [category, line, numbers, concealed, value, notes, advanced]) el.addEventListener('input', update);

  const save = () => {
    const { hand, patternError } = current();
    if (patternError) return toast(patternError);
    if (!hand.line.trim()) return toast('Enter the hand’s line.');
    if (!hand.category.trim()) hand.category = 'Other';
    closeModal();
    updateSelected((c) => (index >= 0 ? updateHand(c, index, hand) : addHand(c, hand)), index >= 0 ? 'Hand saved.' : 'Hand added.');
  };

  openModal(index >= 0 ? `Edit hand ${index + 1}` : 'Add a hand', [
    h('datalist', { id: 'categories' }, ...CATEGORY_SUGGESTIONS.map((c) => h('option', { value: c }))),
    h('label', { class: 'field-stack' }, h('span', {}, 'Line, as printed'), line),
    h('details', { class: 'notation' },
      h('summary', {}, 'How to type a line'),
      h('ul', {},
        h('li', {}, 'Separate groups with spaces: ', h('code', {}, '1111'), ' is a kong, ', h('code', {}, 'FF'), ' a pair of flowers.'),
        h('li', {}, 'Add the printed color after numbers and dragons: ', h('code', {}, 'g'), ' green, ', h('code', {}, 'r'), ' red, ', h('code', {}, 'b'), ' blue. Same color = same suit.'),
        h('li', {}, h('code', {}, 'D'), ' is the dragon of its color’s suit; ', h('code', {}, '0'), ' is Soap; ', h('code', {}, 'F'), ' flower; ', h('code', {}, 'N E W S'), ' winds.'),
        h('li', {}, 'Mixed characters are single tiles: ', h('code', {}, '2026g'), ' is 2, Soap, 2, 6.'),
        h('li', {}, 'Example: ', cardLine('FF 111g 222g 3333r DDr')))),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field-stack' }, h('span', {}, 'Category'), category),
      h('label', { class: 'field-stack' }, h('span', {}, 'Value'), value),
      h('label', { class: 'field-stack' }, h('span', {}, 'Numbers'), numbers),
      h('label', { class: 'field-stack' }, h('span', {}, 'Exposed or concealed'), concealed)),
    h('label', { class: 'field-stack' }, h('span', {}, 'Notes (optional)'), notes),
    h('h3', {}, 'Preview'),
    preview,
    h('details', { class: 'advanced', open: !!draft.pattern },
      h('summary', {}, 'Advanced: enter groups as JSON'),
      h('p', { class: 'muted small' }, 'For hands the line notation can’t express. When filled in, this is used instead of the line (the line is still shown on the card). Example: ',
        h('code', {}, '{"groups":[{"tile":"n","suit":"A","count":4},{"tile":"n+1","suit":"A","count":4},{"tile":"F","count":2},{"tile":"D","suit":"B","count":4}],"constraints":{"n":[1,8]}}')),
      advanced),
    h('div', { class: 'modal-actions' },
      button('Cancel', closeModal),
      button(index >= 0 ? 'Save hand' : 'Add hand', save, { variant: 'primary' })),
  ], { wide: true });
  update();
  line.focus();
}

// ---------- Rendering ----------

function notices() {
  const flags = loadFlags();
  return h('div', { class: 'notices' },
    !canSave ? h('p', { class: 'notice warn' }, 'This browser isn’t letting the site save data (private browsing or blocked storage). Cards you enter will be lost when you leave. Export them to keep them.') : null,
    h('p', { class: 'notice' },
      h('strong', {}, 'Back up your card. '),
      'Your cards are saved only in this browser. Safari on iPad may clear saved data after about a week without a visit, unless you add this site to your Home Screen (Share → Add to Home Screen). Use ',
      h('strong', {}, 'Export'), ' to keep a copy of your card file.'),
    !flags.warnedTypos ? h('div', { class: 'notice' },
      h('p', {}, h('strong', {}, 'Check your typing. '), 'The game uses this card to judge wins and to tell you when an opponent’s exposures don’t match any hand. A mistyped hand can cause a false “dead hand” alert, or miss a real win. The preview shows example tiles so you can check each hand against your printed card.'),
      button('Got it', () => { setFlag('warnedTypos'); render(); })) : null);
}

function cardList() {
  const item = (id, card, extra) => h('li', {},
    h('button', { type: 'button', class: `card-item${id === selectedId ? ' is-selected' : ''}`, onclick: () => { selectedId = id; render(); } },
      h('span', { class: 'card-name' }, card?.name ?? 'Practice Card'),
      h('span', { class: 'card-meta' }, extra),
      store.activeId === id ? h('span', { class: 'badge-play' }, 'In play') : null));
  return h('aside', { class: 'card-list', 'aria-label': 'Your cards' },
    h('h2', {}, 'Cards'),
    h('ul', {},
      item(PRACTICE_ID, practice, 'Included · read-only'),
      ...store.cards.map(({ id, card }) => item(id, card, `${card.hands.length} hand${card.hands.length === 1 ? '' : 's'}${card.year ? ` · ${card.year}` : ''}`))),
    h('div', { class: 'list-actions' },
      button('New card', newCardDialog, { variant: 'primary' }),
      button('Import a file', pickFile)));
}

function cardHeader(card) {
  const ro = readOnly();
  const name = h('input', { type: 'text', value: card.name, disabled: ro, 'aria-label': 'Card name' });
  const year = h('input', { type: 'number', inputmode: 'numeric', value: card.year ?? '', disabled: ro, placeholder: 'Year', 'aria-label': 'Year' });
  name.addEventListener('change', () => updateSelected((c) => ({ ...c, name: name.value.trim() || 'Untitled card' })));
  year.addEventListener('change', () => updateSelected((c) => ({ ...c, year: Number.parseInt(year.value, 10) || null })));
  const errors = validateCard({ ...card, name: card.name || 'x' }).filter((e) => e.index !== null);
  const badHands = new Set(errors.map((e) => e.index)).size;
  const playable = card.hands.length - badHands;
  return h('div', { class: 'card-head' },
    h('div', { class: 'card-title' }, name, year),
    h('p', { class: 'muted' },
      `${card.hands.length} hand${card.hands.length === 1 ? '' : 's'}`,
      badHands ? h('span', { class: 'error' }, ` · ${badHands} need${badHands === 1 ? 's' : ''} fixing (skipped in play)`) : null,
      ro ? ' · The practice card can’t be edited; make a copy to change it.' : null),
    h('div', { class: 'card-actions' },
      button(store.activeId === selectedId ? 'In play' : 'Play with this card', () => {
        if (playable === 0) return toast('This card has no playable hands yet.');
        commit(setActive(store, selectedId), `“${card.name}” will be used from your next hand.`);
      }, { variant: 'primary', disabled: store.activeId === selectedId }),
      ro ? null : button('Add a hand', () => handForm(-1)),
      button('Export', () => download(card), { title: 'Save this card as a file on your device' }),
      button(ro ? 'Make an editable copy' : 'Duplicate', () => {
        const id = newId();
        selectedId = id;
        commit(putCard(store, id, copyOfCard(card)), 'Copy created.');
      }),
      ro ? null : button('Delete card', () => confirmDialog('Delete this card?', `“${card.name}” will be removed from this browser. Export it first if you might want it later.`, () => {
        const next = removeCard(store, selectedId);
        selectedId = next.activeId;
        commit(next, 'Card deleted.');
      }))));
}

function handTable(card) {
  const ro = readOnly();
  if (!card.hands.length) {
    return h('div', { class: 'empty' },
      h('p', {}, 'No hands yet.'),
      ro ? null : button('Add the first hand', () => handForm(-1), { variant: 'primary' }));
  }
  const errors = validateCard({ ...card, name: card.name || 'x' });
  const errorFor = (i) => errors.filter((e) => e.index === i).map((e) => e.message).join('; ');
  let lastCategory = null;
  const rows = [];
  card.hands.forEach((hand, i) => {
    if (hand.category !== lastCategory) {
      rows.push(h('li', { class: 'cat-head' }, hand.category || 'Other'));
      lastCategory = hand.category;
    }
    const err = errorFor(i);
    rows.push(h('li', { class: `hand-row${err ? ' has-error' : ''}` },
      h('div', { class: 'hand-main' },
        cardLine(hand.line),
        h('span', { class: 'hand-val' }, `${hand.value} ${hand.concealed ? 'C' : 'X'}`),
        hand.numbers === 'shift' ? h('span', { class: 'tag' }, 'any numbers') : null,
        hand.pattern ? h('span', { class: 'tag' }, 'advanced') : null,
        hand.notes ? h('span', { class: 'muted' }, hand.notes) : null,
        err ? h('span', { class: 'error' }, err) : null),
      ro ? null : h('div', { class: 'hand-actions' },
        button('Edit', () => handForm(i)),
        button('↑', () => updateSelected((c) => moveHand(c, i, i - 1)), { disabled: i === 0, title: 'Move up' }),
        button('↓', () => updateSelected((c) => moveHand(c, i, i + 1)), { disabled: i === card.hands.length - 1, title: 'Move down' }),
        button('Copy', () => updateSelected((c) => duplicateHand(c, i), 'Hand duplicated.'), { title: 'Duplicate this hand' }),
        button('Delete', () => confirmDialog('Delete this hand?', hand.line, () => updateSelected((c) => removeHand(c, i), 'Hand deleted.'))))));
  });
  return h('ol', { class: 'hands' }, ...rows);
}

function render() {
  const card = selectedCard();
  if (!card) {
    selectedId = PRACTICE_ID;
    return render();
  }
  mount(root,
    notices(),
    h('div', { class: 'editor-body' },
      cardList(),
      h('main', { class: 'card-main' }, cardHeader(card), handTable(card))));
}

async function start() {
  try {
    const res = await fetch('data/practice-card.json');
    if (!res.ok) throw new Error(String(res.status));
    practice = await res.json();
  } catch {
    practice = { schema: 1, name: 'Practice Card', year: null, source: 'practice', hands: [] };
    toast('Couldn’t load the practice card.');
  }
  if (selectedId !== PRACTICE_ID && !getCard(store, selectedId)) selectedId = PRACTICE_ID;
  render();
}

start();
