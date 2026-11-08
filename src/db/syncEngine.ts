/**
 * Moteur de synchronisation côté appareil — logique PURE (aucune dépendance Capacitor/React).
 *
 * Principe : l'appareil reste maître hors ligne. À chaque écriture locale on compare l'état à une
 * « base de référence » (empreintes de chaque enregistrement + stocks + soldes) et on en déduit des
 * EFFETS : enregistrements créés/modifiés, variations de stock, variations de solde. Les effets sont
 * mis en file puis rejoués côté serveur de façon idempotente.
 */

export const SYNC_COLLS = [
  'settings', 'categories', 'customers', 'suppliers', 'products',
  'stockMovements', 'sales', 'purchases', 'expenses', 'debts', 'reservations',
  'reservationPayments', 'reservationCancellations', 'reservationDeliveries', 'stockDamages', 'freeIssues',
] as const;
export type SyncColl = (typeof SYNC_COLLS)[number];

/** Ordre de lecture : les produits avant leurs stocks, les tiers avant les dettes. */
export const PULL_ORDER: string[] = [...SYNC_COLLS, 'stock', '__tombstones'];

const DELETABLE = new Set<string>(['products', 'categories']);
const EXCLUDED: Record<string, string[]> = {
  products: ['currentStock', 'syncStatus'],
  customers: ['debtBalanceUSD', 'syncStatus'],
  suppliers: ['balanceDueUSD', 'syncStatus'],
};
const DEFAULT_EXCLUDED = ['syncStatus'];
const SERVER_FIELDS = ['serverVersion', '_at', 'negative', 'migrationId', 'migratedBy', 'migratedAt'];
const SORT_DESC: Record<string, string> = { sales: 'date', purchases: 'date', expenses: 'date', stockMovements: 'date' };

export interface Effects {
  upserts: { c: string; id: string; doc: Record<string, unknown> }[];
  deletes: { c: string; id: string }[];
  stockDeltas: { productId: string; delta: number }[];
  balanceDeltas: { c: 'customers' | 'suppliers'; id: string; delta: number }[];
}

export interface Baseline {
  rec: Record<string, Record<string, string>>;
  stock: Record<string, number>;
  bal: Record<string, number>; // « customers:ID » / « suppliers:ID »
}

type AnyState = Record<string, any>;

/** Les paramètres sont un objet unique côté appareil : on les traite comme une collection d'un seul élément. */
const listOf = (state: AnyState, c: string): any[] =>
  c === 'settings' ? (state.settings ? [{ id: 'general', ...state.settings }] : []) : ((state[c] ?? []) as any[]);

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function stable(v: unknown): string {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'u';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

/** Empreinte 53 bits (cyrb53) : collision négligeable pour ce volume de données. */
export function hashOf(v: unknown): string {
  const s = stable(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function cleanRecord(c: string, rec: Record<string, any>): Record<string, any> {
  const skip = new Set(EXCLUDED[c] ?? DEFAULT_EXCLUDED);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) if (!skip.has(k) && v !== undefined) out[k] = v;
  return JSON.parse(JSON.stringify(out));
}

export function makeBaseline(state: AnyState): Baseline {
  const b: Baseline = { rec: {}, stock: {}, bal: {} };
  for (const c of SYNC_COLLS) {
    b.rec[c] = {};
    for (const r of listOf(state, c)) b.rec[c][r.id] = hashOf(cleanRecord(c, r));
  }
  for (const p of (state.products ?? []) as any[]) b.stock[p.id] = Number(p.currentStock) || 0;
  for (const x of (state.customers ?? []) as any[]) b.bal['customers:' + x.id] = Number(x.debtBalanceUSD) || 0;
  for (const x of (state.suppliers ?? []) as any[]) b.bal['suppliers:' + x.id] = Number(x.balanceDueUSD) || 0;
  return b;
}

/** Calcule les effets depuis la base de référence. `effects` vaut null si rien n'a changé. */
export function diffState(state: AnyState, base: Baseline): { effects: Effects | null; baseline: Baseline } {
  const e: Effects = { upserts: [], deletes: [], stockDeltas: [], balanceDeltas: [] };
  for (const c of SYNC_COLLS) {
    const known = base.rec[c] ?? {};
    const seen = new Set<string>();
    for (const r of listOf(state, c)) {
      if (!r || typeof r.id !== 'string') continue;
      seen.add(r.id);
      const doc = cleanRecord(c, r);
      if (known[r.id] !== hashOf(doc)) e.upserts.push({ c, id: r.id, doc });
    }
    if (DELETABLE.has(c)) for (const id of Object.keys(known)) if (!seen.has(id)) e.deletes.push({ c, id });
  }
  for (const p of (state.products ?? []) as any[]) {
    const delta = r6((Number(p.currentStock) || 0) - (base.stock[p.id] ?? 0));
    if (delta !== 0) e.stockDeltas.push({ productId: p.id, delta });
  }
  // Aggregate customer/supplier balances are server derived from sales, purchases and
  // newly accepted debt-payment history entries. A client supplied balance delta is never authoritative.
  const empty = !e.upserts.length && !e.deletes.length && !e.stockDeltas.length && !e.balanceDeltas.length;
  return { effects: empty ? null : e, baseline: makeBaseline(state) };
}

/** Découpe une très grosse opération (ex. inventaire complet) ; les cas courants restent atomiques. */
export function splitEffects(e: Effects, max = 250): Effects[] {
  const total = e.upserts.length + e.deletes.length + e.stockDeltas.length + e.balanceDeltas.length;
  if (total <= max) return [e];
  const parts: Effects[] = [];
  const fresh = (): Effects => ({ upserts: [], deletes: [], stockDeltas: [], balanceDeltas: [] });
  let cur = fresh(); let n = 0;
  const push = <K extends keyof Effects>(k: K, item: Effects[K][number]) => {
    if (n >= max) { parts.push(cur); cur = fresh(); n = 0; }
    (cur[k] as unknown[]).push(item); n++;
  };
  // Keep each newly-created sale/purchase with its opening debt record. The server validates
  // that relation within one transaction. Other entities remain ordered before transactions.
  const pairedDebtIds = new Set<string>();
  const transactionGroups: Effects['upserts'][] = [];
  for (const transaction of e.upserts.filter((x) => x.c === 'sales' || x.c === 'purchases')) {
    const expectedType = transaction.c === 'sales' ? 'CUSTOMER' : 'SUPPLIER';
    const invoice = transaction.c === 'sales' ? transaction.doc.invoiceNumber : transaction.doc.purchaseNumber;
    const debt = e.upserts.find((x) => x.c === 'debts' && x.doc.type === expectedType &&
      x.doc.referenceInvoice === invoice && !pairedDebtIds.has(x.id));
    transactionGroups.push(debt ? [transaction, debt] : [transaction]);
    if (debt) pairedDebtIds.add(debt.id);
  }
  const transactionIds = new Set(transactionGroups.flat().map((x) => x.id));
  for (const x of e.upserts) if (!transactionIds.has(x.id) && !pairedDebtIds.has(x.id)) push('upserts', x);
  for (const group of transactionGroups) {
    if (n > 0 && n + group.length > max) { parts.push(cur); cur = fresh(); n = 0; }
    for (const x of group) { (cur.upserts as unknown[]).push(x); n++; }
  }
  e.deletes.forEach((x) => push('deletes', x));
  e.balanceDeltas.forEach((x) => push('balanceDeltas', x));
  e.stockDeltas.forEach((x) => push('stockDeltas', x));
  parts.push(cur);
  return parts;
}

/** Applique des documents serveur à l'état local ET à la base de référence (pas d'écho vers le serveur). */
export function applyPulled(
  state: AnyState, base: Baseline, c: string, docs: { id: string; data: Record<string, any> }[]
): number {
  let applied = 0;
  if (c === 'stock') {
    for (const d of docs) {
      const p = (state.products as any[]).find((x) => x.id === d.id);
      if (!p || typeof d.data.currentStock !== 'number') continue;
      p.currentStock = d.data.currentStock;
      base.stock[p.id] = d.data.currentStock;
      applied++;
    }
    return applied;
  }
  if (c === 'settings') {
    const d = docs.find((x) => x.id === 'general');
    if (!d) return 0;
    const rec: Record<string, any> = {};
    for (const [k, v] of Object.entries(d.data)) if (!SERVER_FIELDS.includes(k) && k !== 'id') rec[k] = v;
    state.settings = { ...state.settings, ...rec };
    (base.rec.settings ??= {}).general = hashOf(cleanRecord('settings', { id: 'general', ...state.settings }));
    return 1;
  }
  if (c === '__tombstones') {
    for (const d of docs) {
      const collection = d.data.collection;
      const id = d.data.documentId;
      if ((collection !== 'products' && collection !== 'categories') || typeof id !== 'string') continue;
      const list = state[collection] as any[];
      const index = list.findIndex((x) => x.id === id);
      if (index >= 0) list.splice(index, 1);
      delete base.rec[collection]?.[id];
      if (collection === 'products') delete base.stock[id];
      applied++;
    }
    return applied;
  }
  if (!(SYNC_COLLS as readonly string[]).includes(c)) return 0;
  const list: any[] = state[c];
  const index = new Map<string, number>(list.map((r, i) => [r.id, i]));
  for (const d of docs) {
    const rec: Record<string, any> = {};
    for (const [k, v] of Object.entries(d.data)) if (!SERVER_FIELDS.includes(k)) rec[k] = v;
    rec.id = d.id;
    const at = index.get(d.id);
    const local = at === undefined ? undefined : list[at];
    if (c === 'products') rec.currentStock = local?.currentStock ?? 0;
    if (c === 'customers') {
      rec.debtBalanceUSD = Number(d.data.debtBalanceUSD) || 0;
      base.bal['customers:' + d.id] = rec.debtBalanceUSD;
    }
    if (c === 'suppliers') {
      rec.balanceDueUSD = Number(d.data.balanceDueUSD) || 0;
      base.bal['suppliers:' + d.id] = rec.balanceDueUSD;
    }
    if (c === 'sales' || c === 'purchases' || c === 'expenses') rec.syncStatus = 'SYNCED';
    if (at === undefined) { list.push(rec); index.set(d.id, list.length - 1); } else list[at] = rec;
    if (c === 'products') base.stock[d.id] = base.stock[d.id] ?? 0;
    (base.rec[c] ??= {})[d.id] = hashOf(cleanRecord(c, rec));
    applied++;
  }
  const key = SORT_DESC[c];
  if (key && applied) list.sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? '')));
  return applied;
}

/** Identifiants de ventes/achats/dépenses contenus dans des effets (pour marquer SYNCED / ERROR). */
export function trackedIds(e: Effects): Record<'sales' | 'purchases' | 'expenses', string[]> {
  const out = { sales: [] as string[], purchases: [] as string[], expenses: [] as string[] };
  for (const u of e.upserts) if (u.c === 'sales' || u.c === 'purchases' || u.c === 'expenses') out[u.c].push(u.id);
  return out;
}
