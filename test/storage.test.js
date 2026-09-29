import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSON, writeJSON, storageAvailable, loadCards, saveCards, loadFlags, setFlag, KEYS, loadSettings, saveSettings, loadLedger, saveLedger, clearLedger } from '../js/storage.js';
import { defaultSettings } from '../js/settings.js';
import { emptyLedger } from '../js/ledger.js';
import { emptyStore, putCard, blankCard } from '../js/cardStore.js';

function fakeStorage({ throwOnSet = false } = {}) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { if (throwOnSet) throw new Error('QuotaExceededError'); data.set(k, String(v)); },
    removeItem: (k) => data.delete(k),
    data,
  };
}

function withStorage(value, fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...value });
  try {
    fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
}

test('works with no localStorage at all', () => {
  withStorage({ value: undefined }, () => {
    assert.equal(storageAvailable(), false);
    assert.deepEqual(loadCards(), emptyStore());
    assert.equal(saveCards(emptyStore()), false);
    assert.deepEqual(loadFlags(), {});
  });
});

test('works when touching localStorage throws', () => {
  withStorage({ get() { throw new Error('SecurityError'); } }, () => {
    assert.equal(storageAvailable(), false);
    assert.deepEqual(readJSON('x', 42), 42);
    assert.equal(writeJSON('x', 1), false);
    assert.deepEqual(loadCards(), emptyStore());
  });
});

test('works when storage is full', () => {
  withStorage({ value: fakeStorage({ throwOnSet: true }) }, () => {
    assert.equal(storageAvailable(), false);
    assert.equal(saveCards(emptyStore()), false);
  });
});

test('corrupt data falls back to an empty library', () => {
  const s = fakeStorage();
  s.setItem(KEYS.cards, '{not json');
  s.setItem(KEYS.flags, '[1]');
  withStorage({ value: s }, () => {
    assert.deepEqual(loadCards(), emptyStore());
    assert.deepEqual(loadFlags(), {});
  });
});

test('cards and flags round-trip', () => {
  withStorage({ value: fakeStorage() }, () => {
    assert.equal(storageAvailable(), true);
    const store = putCard(emptyStore(), 'c1', blankCard('Mine', 2026), 't');
    assert.equal(saveCards(store), true);
    assert.deepEqual(loadCards(), store);
    setFlag('warnedTypos');
    setFlag('other', 3);
    assert.deepEqual(loadFlags(), { warnedTypos: true, other: 3 });
  });
});

test('settings and ledger round-trip, and fall back when storage is unavailable', () => {
  withStorage({ value: fakeStorage() }, () => {
    const settings = { ...defaultSettings(), speed: 'slow', tips: { offense: false, defense: true }, tipsChosen: true };
    assert.equal(saveSettings(settings), true);
    assert.deepEqual(loadSettings({ returning: true }), settings);
    const ledger = { schema: 1, records: [{ timestamp: 't', payments: [0, 0, 0, 0], human: 1 }] };
    assert.equal(saveLedger(ledger), true);
    assert.deepEqual(loadLedger(), ledger);
    clearLedger();
    assert.deepEqual(loadLedger(), emptyLedger());
  });
  withStorage({ value: undefined }, () => {
    assert.deepEqual(loadSettings(), defaultSettings());
    assert.equal(saveSettings(defaultSettings()), false);
    assert.deepEqual(loadLedger(), emptyLedger());
  });
});
