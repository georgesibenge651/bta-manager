import test from "node:test";
import assert from "node:assert/strict";
import {validateEffects, missingPermission, plan, SyncRejection, Effects} from "./syncPlan";

const T = "t1"; const B = "b1";
const empty = (): Effects => ({upserts: [], deletes: [], stockDeltas: [], balanceDeltas: []});
const sale = (over: any = {}) => ({
  id: "s1", items: [{productId: "p1", quantity: 2, unitPriceUSD: 5}], discountUSD: 0,
  totalUSD: 10, amountPaidUSD: 10, debtAmountUSD: 0, exchangeRate: 2800, ...over,
});

test("vente valide : stock décrémenté et marqué", () => {
  const e = validateEffects({...empty(), upserts: [{c: "sales", id: "s1", doc: sale()}],
    stockDeltas: [{productId: "p1", delta: -2}]});
  const ex = new Map([[`tenants/${T}/branches/${B}/stock/p1`, {currentStock: 5}],
    [`tenants/${T}/products/p1`, {id: "p1"}]]);
  const r = plan(T, B, e, ex, 1000, 2000);
  assert.equal(r.sets.get(`tenants/${T}/branches/${B}/stock/p1`).currentStock, 3);
  assert.ok(r.sets.has(`tenants/${T}/branches/${B}/sales/s1`));
});

test("stock insuffisant : la vente est acceptée mais signalée (jamais perdue)", () => {
  const e = validateEffects({...empty(), upserts: [{c: "sales", id: "s1", doc: sale()}],
    stockDeltas: [{productId: "p1", delta: -2}]});
  const ex = new Map([[`tenants/${T}/branches/${B}/stock/p1`, {currentStock: 1}],
    [`tenants/${T}/products/p1`, {id: "p1"}]]);
  const r = plan(T, B, e, ex, 1, 2);
  const st = r.sets.get(`tenants/${T}/branches/${B}/stock/p1`);
  assert.equal(st.currentStock, -1);
  assert.equal(st.negative, true);
  assert.ok(r.notes.some((n) => n.startsWith("NEGATIVE_STOCK")));
});

test("deux téléphones vendent : les deltas s'additionnent", () => {
  const path = `tenants/${T}/branches/${B}/stock/p1`;
  const mk = () => validateEffects({...empty(), stockDeltas: [{productId: "p1", delta: -3}]});
  const a = plan(T, B, mk(), new Map([[path, {currentStock: 10}]]), 1, 1);
  const b = plan(T, B, mk(), new Map([[path, a.sets.get(path)]]), 2, 2);
  assert.equal(b.sets.get(path).currentStock, 4);
});

test("vente falsifiée refusée (total incohérent, crédit sans client)", () => {
  const bad = (doc: any) => () => plan(T, B,
    validateEffects({...empty(), upserts: [{c: "sales", id: "s1", doc}]}), new Map(), 1, 1);
  assert.throws(bad(sale({totalUSD: 1})), SyncRejection);
  assert.throws(bad(sale({amountPaidUSD: 4, debtAmountUSD: 6})), SyncRejection);
  assert.throws(bad(sale({items: [{productId: "p", quantity: -1, unitPriceUSD: 5}]})), SyncRejection);
});

test("rejeu d'une vente existante : ignorée, pas de doublon", () => {
  const e = validateEffects({...empty(), upserts: [{c: "sales", id: "s1", doc: sale()}]});
  const ex = new Map([[`tenants/${T}/branches/${B}/sales/s1`, {id: "s1", _at: 5}]]);
  const r = plan(T, B, e, ex, 9, 9);
  assert.equal(r.sets.size, 0);
});

test("dette : deux paiements concurrents sont fusionnés", () => {
  const path = `tenants/${T}/branches/${B}/debts/d1`;
  const base = {id: "d1", type: "CUSTOMER", partyId: "c1", referenceInvoice: "FAC-1",
    initialAmountUSD: 100, paidAmountUSD: 0, remainingBalanceUSD: 100, history: []};
  const h1 = {id: "h1", date: "2026-01-01", amountUSD: 30, exchangeRate: 2800};
  const h2 = {id: "h2", date: "2026-01-02", amountUSD: 20, exchangeRate: 2800};
  const partyPath = `tenants/${T}/customers/c1`;
  const first = plan(T, B, validateEffects({...empty(),
    upserts: [{c: "debts", id: "d1", doc: {...base, history: [h1]}}]}),
  new Map<string, any>([[path, base], [partyPath, {id: "c1", debtBalanceUSD: 100}]]), 1, 1);
  const second = plan(T, B, validateEffects({...empty(),
    upserts: [{c: "debts", id: "d1", doc: {...base, history: [h2]}}]}),
  new Map<string, any>([[path, first.sets.get(path)], [partyPath, first.sets.get(partyPath)]]), 2, 2);
  const d = second.sets.get(path);
  assert.equal(d.history.length, 2);
  assert.equal(d.paidAmountUSD, 50);
  assert.equal(d.remainingBalanceUSD, 50);
  assert.equal(second.sets.get(partyPath).debtBalanceUSD, 50);
});

test("solde client : le client ne peut pas écrire de delta ni écraser le solde", () => {
  const path = `tenants/${T}/customers/c1`;
  const upd = plan(T, B, validateEffects({...empty(),
    upserts: [{c: "customers", id: "c1", doc: {id: "c1", name: "X", debtBalanceUSD: 999}}]}),
  new Map([[path, {id: "c1", debtBalanceUSD: 40, _at: 0}]]), 5, 5);
  assert.equal(upd.sets.get(path).debtBalanceUSD, 40);
  assert.throws(() => validateEffects({...empty(), balanceDeltas: [{c: "customers", id: "c1", delta: -100}]}), SyncRejection);
});

test("la dette d'une vente validée augmente le solde calculé côté serveur", () => {
  const customerPath = `tenants/${T}/customers/c1`;
  const e = validateEffects({...empty(), upserts: [{c: "sales", id: "s1", doc: sale({
    customerId: "c1", totalUSD: 10, amountPaidUSD: 4, debtAmountUSD: 6,
  })}]});
  const r = plan(T, B, e, new Map<string, any>([[customerPath, {id: "c1", debtBalanceUSD: 2}],
    [`tenants/${T}/products/p1`, {id: "p1"}]]), 1, 2);
  assert.equal(r.sets.get(customerPath).debtBalanceUSD, 8);
});

test("un paiement nouveau sur dette validée réduit le solde une seule fois", () => {
  const debtPath = `tenants/${T}/branches/${B}/debts/d1`;
  const customerPath = `tenants/${T}/customers/c1`;
  const base = {id: "d1", type: "CUSTOMER", partyId: "c1", referenceInvoice: "FAC-1", initialAmountUSD: 20,
    paidAmountUSD: 0, remainingBalanceUSD: 20, history: []};
  const e = validateEffects({...empty(), upserts: [{c: "debts", id: "d1", doc: {...base,
    history: [{id: "h1", date: "2026-01-01", amountUSD: 5, exchangeRate: 2800}]}}]});
  const r = plan(T, B, e, new Map<string, any>([[debtPath, base], [customerPath, {id: "c1", debtBalanceUSD: 20}]]), 1, 2);
  assert.equal(r.sets.get(customerPath).debtBalanceUSD, 15);
  assert.equal(r.sets.get(debtPath).remainingBalanceUSD, 15);
});

test("modification plus ancienne ignorée (dernier écrit gagne)", () => {
  const path = `tenants/${T}/products/p1`;
  const r = plan(T, B, validateEffects({...empty(), upserts: [{c: "products", id: "p1", doc: {id: "p1", name: "ancien"}}]}),
    new Map([[path, {id: "p1", name: "récent", _at: 500}]]), 100, 101);
  assert.equal(r.sets.size, 0);
});

test("le stock n'est jamais modifiable via une fiche produit", () => {
  const r = plan(T, B, validateEffects({...empty(), upserts: [{c: "products", id: "p1", doc: {id: "p1", currentStock: 9999}}]}),
    new Map(), 1, 1);
  assert.equal(r.sets.get(`tenants/${T}/products/p1`).currentStock, undefined);
});

test("suppression crée un tombstone auditable et retire le document", () => {
  const p = `tenants/${T}/products/p1`;
  const e = validateEffects({...empty(), deletes: [{c: "products", id: "p1"}]});
  const r = plan(T, B, e, new Map([[p, {id: "p1", name: "Riz", _at: 1}]]), 2, 3, "op-1");
  assert.deepEqual(r.deletes, [p]);
  const event = [...r.sets.entries()].find(([path]) => path.includes("/tombstones/"))?.[1];
  assert.equal(event?.operationId, "op-1");
  assert.equal(event?.documentId, "p1");
});

test("une écriture ne peut pas faire réapparaître un produit supprimé", () => {
  const p = `tenants/${T}/products/p1`;
  const head = `tenants/${T}/tombstoneHeads/products_p1`;
  const e = validateEffects({...empty(), upserts: [{c: "products", id: "p1", doc: {id: "p1", name: "Ancien"}}]});
  const r = plan(T, B, e, new Map([[head, {documentId: "p1", _at: 100}]]), 50, 101);
  assert.equal(r.sets.has(p), false);
  assert.ok(r.notes.some((n) => n.startsWith("DELETED")));
});

test("permissions : un caissier ne peut ni créer de produit ni augmenter le stock", () => {
  const cashier = new Set(["sales.create", "stock.read", "debts.pay"]);
  assert.deepEqual(missingPermission(validateEffects({...empty(), upserts: [{c: "products", id: "p", doc: {id: "p"}}]}), cashier), ["stock.manage"]);
  assert.ok(missingPermission(validateEffects({...empty(), stockDeltas: [{productId: "p", delta: 50}]}), cashier));
  assert.equal(missingPermission(validateEffects({...empty(), stockDeltas: [{productId: "p", delta: -1}]}), cashier), null);
});

test("validation : collections, identifiants et volumes", () => {
  assert.throws(() => validateEffects({upserts: [{c: "members", id: "x", doc: {id: "x"}}]}), SyncRejection);
  assert.throws(() => validateEffects({upserts: [{c: "sales", id: "../x", doc: {id: "../x"}}]}), SyncRejection);
  assert.throws(() => validateEffects({deletes: [{c: "sales", id: "x"}]}), SyncRejection);
  assert.throws(() => validateEffects({}), SyncRejection);
  assert.throws(() => validateEffects({stockDeltas: [{productId: "p", delta: NaN}]}), SyncRejection);
});

test("paramètres : taux de change borné, réservé à branch.settings", () => {
  const mkS = (rate: unknown) => validateEffects({...empty(), upserts: [{c: "settings", id: "general", doc: {id: "general", exchangeRate: rate}}]});
  assert.doesNotThrow(() => plan(T, B, mkS(2800), new Map(), 1, 1));
  assert.throws(() => plan(T, B, mkS(5), new Map(), 1, 1), SyncRejection);
  assert.deepEqual(missingPermission(mkS(2800), new Set(["sales.create"])), ["branch.settings"]);
  assert.ok(plan(T, B, mkS(2800), new Map(), 1, 1).sets.has(`tenants/${T}/settings/general`));
});
