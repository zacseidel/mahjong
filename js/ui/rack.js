// The human's rack: display order, selection, drag to reorder, and auto-sort.
// Each slot has a stable uid so duplicates and reordering don't confuse selection.

import { tileEl } from './tileArt.js';

const DRAG_THRESHOLD = 8;

export class Rack {
  /**
   * @param {HTMLElement} el
   * @param {{onChange: () => void, onTapSelected?: (tile: number) => void}} handlers
   */
  constructor(el, { onChange, onTapSelected }) {
    this.el = el;
    this.onChange = onChange;
    this.onTapSelected = onTapSelected;
    this.slots = []; // {uid, tile}
    this.selected = new Set();
    this.fresh = new Set();
    this.highlight = new Set(); // tile ids to highlight (tips)
    this.highlightUids = new Set(); // specific tiles to highlight (a suggested pass or discard)
    this.marks = new Map(); // tile id → danger mark (stage 7)
    this.nextUid = 1;
    this.limit = 0;
    this.tapAgain = 'toggle';
  }

  /** Match the display to the hand, keeping order; new tiles go on the right and are marked fresh. */
  sync(hand) {
    const remaining = hand.slice();
    const kept = [];
    for (const slot of this.slots) {
      const i = remaining.indexOf(slot.tile);
      if (i >= 0) {
        remaining.splice(i, 1);
        kept.push(slot);
      }
    }
    const added = remaining.map((tile) => ({ uid: this.nextUid++, tile }));
    const firstSync = this.slots.length === 0;
    const changed = added.length > 0 || kept.length !== this.slots.length;
    this.slots = [...kept, ...added];
    // Fresh marks last until the hand changes again (renders without a change keep them).
    if (changed) this.fresh = new Set(firstSync ? [] : added.map((s) => s.uid));
    for (const uid of [...this.selected]) if (!this.slots.some((s) => s.uid === uid)) this.selected.delete(uid);
    if (firstSync) this.sort();
  }

  reset() {
    this.slots = [];
    this.selected.clear();
    this.fresh.clear();
  }

  sort() {
    this.slots.sort((a, b) => a.tile - b.tile || a.uid - b.uid);
  }

  /** How many tiles may be selected, and what tapping a selected tile does. */
  setMode(limit, tapAgain = 'toggle') {
    this.limit = limit;
    this.tapAgain = tapAgain;
    while (this.selected.size > limit) this.selected.delete([...this.selected][0]);
  }

  selectedTiles() {
    return this.slots.filter((s) => this.selected.has(s.uid)).map((s) => s.tile);
  }

  clearSelection() {
    this.selected.clear();
  }

  /** Highlight exactly these tiles (a multiset: one rack tile per entry), e.g. a suggested pass. */
  highlightExactly(tiles) {
    this.highlightUids = new Set();
    for (const t of tiles) {
      const slot = this.slots.find((x) => x.tile === t && !this.highlightUids.has(x.uid));
      if (slot) this.highlightUids.add(slot.uid);
    }
  }

  /** Select these tiles (a multiset), e.g. to show a suggested pass or discard. */
  selectTiles(tiles) {
    this.selected.clear();
    for (const t of tiles) {
      const slot = this.slots.find((x) => x.tile === t && !this.selected.has(x.uid));
      if (slot) this.selected.add(slot.uid);
    }
  }

  tap(uid) {
    const slot = this.slots.find((s) => s.uid === uid);
    if (!slot || this.limit === 0) return;
    if (this.selected.has(uid)) {
      if (this.tapAgain === 'discard' && this.onTapSelected) return this.onTapSelected(slot.tile);
      this.selected.delete(uid);
    } else {
      if (this.selected.size >= this.limit) {
        if (this.limit === 1) this.selected.clear();
        else return;
      }
      this.selected.add(uid);
    }
    this.onChange();
  }

  render() {
    const els = this.slots.map((slot) => {
      const classes = [
        this.selected.has(slot.uid) && 'is-selected',
        this.fresh.has(slot.uid) && 'is-fresh',
        (this.highlight.has(slot.tile) || this.highlightUids.has(slot.uid)) && 'is-highlight',
      ].filter(Boolean).join(' ');
      const el = tileEl(slot.tile, { size: 'lg', button: true, className: classes });
      el.dataset.uid = String(slot.uid);
      el.setAttribute('aria-pressed', this.selected.has(slot.uid) ? 'true' : 'false');
      const mark = this.marks.get(slot.tile);
      if (mark) el.append(Object.assign(document.createElement('span'), { className: `danger danger-${mark.level}`, textContent: mark.symbol, title: mark.label }));
      this.attachDrag(el, slot.uid);
      return el;
    });
    this.el.replaceChildren(...els);
  }

  attachDrag(el, uid) {
    let start = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, dragging: false, id: e.pointerId };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // The pointer may already be gone (fast taps on some touch devices); dragging just won't capture.
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      if (!start.dragging && Math.abs(dx) > DRAG_THRESHOLD) {
        start.dragging = true;
        el.classList.add('is-dragging');
      }
      if (start.dragging) el.style.transform = `translate(${dx}px, -6px)`;
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const wasDragging = start.dragging;
      start = null;
      el.style.transform = '';
      el.classList.remove('is-dragging');
      if (!wasDragging) return this.tap(uid);
      this.moveTo(uid, this.dropIndex(e.clientX, uid));
      this.render();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => {
      start = null;
      el.style.transform = '';
      el.classList.remove('is-dragging');
    });
    // Keyboard: Enter/Space select (native button click), arrows move.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = this.slots.findIndex((s) => s.uid === uid);
      const j = Math.max(0, Math.min(this.slots.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
      this.moveTo(uid, j);
      this.render();
      this.el.querySelector(`[data-uid="${uid}"]`)?.focus();
    });
    el.addEventListener('click', (e) => {
      if (e.detail === 0) this.tap(uid); // keyboard activation
    });
  }

  dropIndex(x, uid) {
    const others = [...this.el.children].filter((c) => c.dataset.uid !== String(uid));
    let index = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (x < r.left + r.width / 2) { index = i; break; }
    }
    return index;
  }

  moveTo(uid, index) {
    const i = this.slots.findIndex((s) => s.uid === uid);
    const [slot] = this.slots.splice(i, 1);
    this.slots.splice(index, 0, slot);
  }
}
