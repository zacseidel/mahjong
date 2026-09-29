// stats.html: hand history, stats split by tips on/off, sessions, and CSV export (SPEC §11.3).

import { h, mount, button } from './dom.js';
import { openModal, closeModal } from './modals.js';
import { formatPoints } from './format.js';
import { loadLedger, clearLedger, loadSettings, storageAvailable } from '../storage.js';
import { computeStats, sessions, toCSV } from '../ledger.js';

const root = document.getElementById('stats');
const POSITIONS = ['You', 'Right', 'Across', 'Left'];
const mode = loadSettings().points;

const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const num = (x) => (x === null ? '—' : x.toFixed(1).replace(/\.0$/, ''));
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const rel = (seat, human) => (seat - human + 4) % 4;

const METRICS = [
  ['Hands played', (s) => String(s.hands)],
  ['Win rate', (s) => pct(s.winRate)],
  ['Deal-in rate', (s) => pct(s.dealInRate), 'How often your discard gave someone else Mah Jongg. Lower is better; this is the key defensive stat.'],
  ['Self-drawn share of wins', (s) => pct(s.selfDrawShare)],
  ['Average winning hand value', (s) => num(s.averageWinValue)],
  ['Jokerless wins', (s) => pct(s.jokerlessRate), 'Share of your wins with no jokers.'],
  ['Wall games', (s) => pct(s.wallGameRate)],
  ['Fold suggestions followed', (s) => (s.foldSuggested ? `${pct(s.foldFollowedRate)} of ${s.foldSuggested}` : '—')],
  ['Net points', (s) => formatPoints(s.net, mode)],
];

function downloadCSV(records) {
  const blob = new Blob([toCSV(records)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `mahjong-hands-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function confirmClear() {
  openModal('Clear your history?', [
    h('p', {}, 'Every recorded hand and stat will be removed from this browser. Export a CSV first if you want a copy.'),
    h('div', { class: 'modal-actions' },
      button('Cancel', closeModal),
      button('Clear history', () => { closeModal(); clearLedger(); render(); }, { variant: 'primary' })),
  ]);
}

function render() {
  const { records } = loadLedger();
  const warn = !storageAvailable()
    ? h('p', { class: 'notice warn' }, 'This browser isn’t letting the site save data, so hands aren’t being recorded.')
    : null;
  if (!records.length) {
    mount(root, h('h1', {}, 'Your stats'), warn,
      h('div', { class: 'empty' }, h('p', {}, 'No hands recorded yet. Finish a hand and your stats will appear here.'),
        h('a', { class: 'btn primary', href: 'index.html' }, 'Play a hand')));
    return;
  }
  const st = computeStats(records);
  const cols = [['All hands', st.all], ['Tips on', st.tipsOn], ['Tips off', st.tipsOff]];

  const table = h('table', { class: 'stats-table' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), ...cols.map(([name]) => h('th', { scope: 'col' }, name)))),
    h('tbody', {}, ...METRICS.map(([label, fmt, help]) => h('tr', {},
      h('th', { scope: 'row' }, label, help ? h('span', { class: 'help' }, help) : null),
      ...cols.map(([, s]) => h('td', {}, s.hands ? fmt(s) : '—'))))));

  const sess = sessions(records).slice(0, 15);
  const sessionTable = h('table', { class: 'stats-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Session'), h('th', {}, 'Hands'), ...POSITIONS.map((p) => h('th', {}, p)))),
    h('tbody', {}, ...sess.map((s) => h('tr', {},
      h('td', {}, when(s.started)), h('td', {}, String(s.hands)),
      ...s.net.map((n, i) => h('td', { class: i === 0 ? 'me' : '' }, formatPoints(n, mode)))))));

  const recent = records.slice(-20).reverse();
  const handList = h('table', { class: 'stats-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Result'), h('th', {}, 'Card'), h('th', {}, 'You'), h('th', {}, 'Tips'))),
    h('tbody', {}, ...recent.map((r) => {
      let result;
      if (r.winner === null) result = 'Wall game';
      else {
        const who = POSITIONS[rel(r.winner, r.human)];
        const how = r.selfDrawn ? 'self-drawn' : `on ${POSITIONS[rel(r.discarder, r.human)] === 'You' ? 'your' : `${POSITIONS[rel(r.discarder, r.human)]}’s`} discard`;
        result = `${who === 'You' ? 'You won' : `${who} won`} ${how} (${r.value}${r.jokerless ? ', jokerless' : ''})`;
      }
      return h('tr', {},
        h('td', {}, when(r.timestamp)), h('td', {}, result), h('td', {}, r.cardName),
        h('td', { class: 'me' }, formatPoints(r.payments[r.human], mode)), h('td', {}, r.tipsOn ? 'On' : 'Off'));
    })));

  mount(root,
    h('h1', {}, 'Your stats'),
    warn,
    h('div', { class: 'tiles-summary' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-num' }, String(st.all.hands)), h('span', {}, 'hands')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-num' }, pct(st.all.winRate)), h('span', {}, 'win rate')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-num' }, pct(st.all.dealInRate)), h('span', {}, 'deal-in rate')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-num' }, formatPoints(st.all.net, mode)), h('span', {}, 'net points'))),
    h('section', {}, h('h2', {}, 'With and without tips'),
      h('p', { class: 'muted' }, 'A hand counts as “tips on” if tips were on for any of your decisions in it.'), table),
    h('section', {}, h('h2', {}, 'Sessions'), h('p', { class: 'muted' }, 'Net points by seat position. A session is one visit to the site.'), sessionTable),
    h('section', {}, h('h2', {}, 'Recent hands'), handList),
    h('div', { class: 'stats-actions' },
      button('Export all hands (CSV)', () => downloadCSV(records), { variant: 'primary' }),
      button('Clear history', confirmClear)),
    h('p', { class: 'muted small' }, `Stats are kept in this browser only: up to the last 1,000 hands.`));
}

render();
