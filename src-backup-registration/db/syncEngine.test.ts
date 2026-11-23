import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBaseline, diffState, splitEffects, applyPulled, trackedIds } from './syncEngine.js';

const mk = () => ({
  categories: [], suppliers: [], stockMovements: [], purchases: [], expenses: [], debts: [], reservations: [],
  reservationPayments: [], reservationCancellations: [], reservationDeliveries: [], stockDamages: [], freeIssues: [],
  products: [{ id: 'p1', name: 'Riz', currentStock: 10, sellPriceUSD: 5 }],
  customers: [{ id: 'c1', name: 'Jean', debtBalanceUSD: 0 }],
  sales: [] as any[],
});

test('aucun changement → aucun effet', () => {
  const s = mk();
  assert.equal(diffState(s, makeBaseline(s)).effects, null);
});

test('vente à crédit : enregistrement + stock ; solde calculé par le serveur', () => {
  const s = mk(); const base = makeBaseline(s);
  s.products[0].currentStock = 8;
  s.customers[0].debtBalanceUSD = 4;
  s.sales.unshift({ id: 's1', totalUSD: 10, syncStatus: 'PENDING' });
  const { effects } = diffState(s, base);
  assert.deepEqual(effects!.stockDeltas, [{ productId: 'p1', delta: -2 }]);
  assert.deepEqual(effects!.balanceDeltas, []);
  assert.equal(effects!.upserts.length, 1);
  assert.equal((effects!.upserts[0].doc as any).syncStatus, undefined);
});

test('changer syncStatus ne produit aucun effet (pas de boucle)', () => {
  const s = mk(); s.sales.push({ id: 's1', totalUSD: 1, syncStatus: 'PENDING' });
  const base = makeBaseline(s);
  s.sales[0].syncStatus = 'SYNCED';
  assert.equal(diffState(s, base).effects, null);
});

test('modification en place d\'une dette détectée', () => {
  const s: any = mk(); s.debts.push({ id: 'd1', history: [], paidAmountUSD: 0 });
  const base = makeBaseline(s);
  s.debts[0].history.push({ id: 'h1', amountUSD: 5 }); s.debts[0].paidAmountUSD = 5;
  assert.equal(diffState(s, base).effects!.upserts[0].c, 'debts');
});

test('suppression de produit propagée ; suppression d\'une vente ignorée', () => {
  const s: any = mk(); s.sales.push({ id: 's1', totalUSD: 1 });
  const base = makeBaseline(s);
  s.products = []; s.sales = [];
  const { effects } = diffState(s, base);
  assert.deepEqual(effects!.deletes, [{ c: 'products', id: 'p1' }]);
});

test('une opération de taille normale reste atomique, une énorme est découpée', () => {
  const s: any = mk(); const base = makeBaseline(s);
  for (let i = 0; i < 400; i++) s.products.push({ id: 'x' + i, currentStock: 1 });
  const { effects } = diffState(s, base);
  const parts = splitEffects(effects!, 250);
  assert.ok(parts.length > 1);
  assert.equal(parts.reduce((n, p) => n + p.upserts.length + p.stockDeltas.length, 0), 800);
});

test('lecture serveur : stock et solde appliqués sans écho', () => {
  const s: any = mk(); const base = makeBaseline(s);
  applyPulled(s, base, 'stock', [{ id: 'p1', data: { currentStock: 3 } }]);
  applyPulled(s, base, 'customers', [{ id: 'c1', data: { name: 'Jean', debtBalanceUSD: 12, serverVersion: 1, _at: 1 } }]);
  applyPulled(s, base, 'sales', [{ id: 's9', data: { totalUSD: 7, date: '2026-01-01', serverVersion: 1 } }]);
  assert.equal(s.products[0].currentStock, 3);
  assert.equal(s.customers[0].debtBalanceUSD, 12);
  assert.equal(s.sales[0].syncStatus, 'SYNCED');
  assert.equal(s.sales[0].serverVersion, undefined);
  assert.equal(diffState(s, base).effects, null);
});

test('tombstone : suppression serveur retire le document local et sa référence', () => {
  const s: any = mk(); const base = makeBaseline(s);
  applyPulled(s, base, '__tombstones', [{ id: 'evt1', data: { collection: 'products', documentId: 'p1' } }]);
  assert.equal(s.products.length, 0);
  assert.equal(base.rec.products.p1, undefined);
  assert.equal(diffState(s, base).effects, null);
});

test('nouveau produit venu du serveur : stock rempli ensuite', () => {
  const s: any = mk(); const base = makeBaseline(s);
  applyPulled(s, base, 'products', [{ id: 'p2', data: { name: 'Huile', serverVersion: 1 } }]);
  applyPulled(s, base, 'stock', [{ id: 'p2', data: { currentStock: 6 } }]);
  assert.equal(s.products.find((p: any) => p.id === 'p2').currentStock, 6);
  assert.equal(diffState(s, base).effects, null);
});

test('trackedIds', () => {
  assert.deepEqual(trackedIds({ upserts: [{ c: 'sales', id: 'a', doc: {} }, { c: 'debts', id: 'b', doc: {} }],
    deletes: [], stockDeltas: [], balanceDeltas: [] }).sales, ['a']);
});

test('paramètres : modification détectée, lecture serveur sans écho', () => {
  const s: any = { ...mk(), settings: { companyName: 'BTA', exchangeRate: 2800 } };
  const base = makeBaseline(s);
  s.settings.exchangeRate = 2900;
  const { effects } = diffState(s, base);
  assert.equal(effects!.upserts[0].c, 'settings');
  assert.equal((effects!.upserts[0].doc as any).exchangeRate, 2900);
  const s2: any = { ...mk(), settings: { companyName: 'BTA', exchangeRate: 2800 } };
  const b2 = makeBaseline(s2);
  applyPulled(s2, b2, 'settings', [{ id: 'general', data: { exchangeRate: 3000, serverVersion: 1, _at: 1 } }]);
  assert.equal(s2.settings.exchangeRate, 3000);
  assert.equal(s2.settings.companyName, 'BTA');
  assert.equal(diffState(s2, b2).effects, null);
});
