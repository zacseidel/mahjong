// Hand history and stats (SPEC §11.3). Pure (no DOM, no storage); storage.js persists the ledger
// under mj.ledger.v1.

export const LEDGER_SCHEMA = 1;
/** Hands kept, and how many of the most recent keep the human's decisions (for replay). */
export const LIMITS = Object.freeze({ maxRecords: 1000, keepDecisions: 100 });

const POSITIONS = ['You', 'Right', 'Across', 'Left'];

/**
 * One finished hand.
 * @param {Object} info
 * @param {string} info.timestamp   ISO time the hand ended.
 * @param {string} info.sessionId   Identifies one sitting (a page visit).
 * @param {number} info.seed
 * @param {number} info.dealer
 * @param {number} info.human       The human's seat.
 * @param {string} info.cardId      'practice' or a stored card id.
 * @param {string} info.cardName
 * @param {Object} info.result      From game state: winner, discarder, selfDrawn, handId, value, jokerless, payments.
 * @param {boolean} info.tipsOn     Tips were on for at least one of the human's decisions.
 * @param {{suggested: number, followed: number}} info.fold
 * @param {Object[]} info.decisions The human's actions in order (seed + these reproduce the hand).
 */
export function makeRecord(info) {
  const r = info.result;
  return {
    timestamp: info.timestamp,
    sessionId: info.sessionId,
    seed: info.seed,
    dealer: info.dealer,
    human: info.human,
    cardId: info.cardId,
    cardName: info.cardName,
    winner: r.winner,
    discarder: r.discarder ?? null,
    selfDrawn: !!r.selfDrawn,
    handId: r.handId ?? null,
    value: r.value ?? 0,
    jokerless: !!r.jokerless,
    payments: r.payments.slice(),
    tipsOn: !!info.tipsOn,
    fold: { suggested: info.fold?.suggested ?? 0, followed: info.fold?.followed ?? 0 },
    decisions: info.decisions ?? [],
  };
}

export function emptyLedger() {
  return { schema: LEDGER_SCHEMA, records: [] };
}

function validRecord(r) {
  return r && typeof r === 'object' && typeof r.timestamp === 'string' && Array.isArray(r.payments)
    && r.payments.length === 4 && Number.isInteger(r.human);
}

/** Coerce whatever was saved into a valid ledger, dropping malformed records. */
export function normalizeLedger(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== LEDGER_SCHEMA || !Array.isArray(raw.records)) return emptyLedger();
  return { schema: LEDGER_SCHEMA, records: raw.records.filter(validRecord) };
}

/**
 * Add a record, trimming the oldest beyond the limit and dropping decisions from older records
 * to keep storage small.
 */
export function appendRecord(ledger, record, limits = LIMITS) {
  let records = [...ledger.records, record];
  if (records.length > limits.maxRecords) records = records.slice(records.length - limits.maxRecords);
  const cut = records.length - limits.keepDecisions;
  records = records.map((r, i) => (i < cut && r.decisions?.length ? { ...r, decisions: [] } : r));
  return { ...ledger, records };
}

const rel = (seat, human) => (seat - human + 4) % 4;
const ratio = (n, d) => (d ? n / d : null);

/**
 * Stats for the human over some records (SPEC §11.3). Rates are 0–1, or null when undefined.
 */
export function statsFor(records) {
  const n = records.length;
  const wins = records.filter((r) => r.winner === r.human);
  const dealIns = records.filter((r) => r.winner !== null && r.winner !== r.human && !r.selfDrawn && r.discarder === r.human);
  const walls = records.filter((r) => r.winner === null);
  const suggested = records.reduce((s, r) => s + (r.fold?.suggested ?? 0), 0);
  const followed = records.reduce((s, r) => s + (r.fold?.followed ?? 0), 0);
  return {
    hands: n,
    wins: wins.length,
    winRate: ratio(wins.length, n),
    dealInRate: ratio(dealIns.length, n),
    selfDrawShare: ratio(wins.filter((r) => r.selfDrawn).length, wins.length),
    averageWinValue: ratio(wins.reduce((s, r) => s + r.value, 0), wins.length),
    jokerlessRate: ratio(wins.filter((r) => r.jokerless).length, wins.length),
    wallGameRate: ratio(walls.length, n),
    foldSuggested: suggested,
    foldFollowedRate: ratio(followed, suggested),
    net: records.reduce((s, r) => s + r.payments[r.human], 0),
  };
}

/** Stats split by whether tips were on. */
export function computeStats(records) {
  return {
    all: statsFor(records),
    tipsOn: statsFor(records.filter((r) => r.tipsOn)),
    tipsOff: statsFor(records.filter((r) => !r.tipsOn)),
  };
}

/**
 * Per-session summaries, newest first: hands played and net points by position (You, Right, …).
 */
export function sessions(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.sessionId)) map.set(r.sessionId, { sessionId: r.sessionId, started: r.timestamp, ended: r.timestamp, hands: 0, net: [0, 0, 0, 0] });
    const s = map.get(r.sessionId);
    s.hands++;
    s.ended = r.timestamp;
    r.payments.forEach((p, seat) => { s.net[rel(seat, r.human)] += p; });
  }
  return [...map.values()].sort((a, b) => (a.started < b.started ? 1 : -1));
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of hands, with seats named relative to the human. */
export function toCSV(records) {
  const header = ['time', 'session', 'card', 'winner', 'hand', 'value', 'self_drawn', 'jokerless', 'discarder',
    'you', 'right', 'across', 'left', 'tips_on', 'seed'];
  const rows = records.map((r) => {
    const byPos = [0, 0, 0, 0];
    r.payments.forEach((p, seat) => { byPos[rel(seat, r.human)] = p; });
    return [
      r.timestamp, r.sessionId, r.cardName,
      r.winner === null ? 'wall game' : POSITIONS[rel(r.winner, r.human)],
      r.handId ?? '', r.value, r.selfDrawn, r.jokerless,
      r.discarder === null ? '' : POSITIONS[rel(r.discarder, r.human)],
      ...byPos, r.tipsOn, r.seed,
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}
