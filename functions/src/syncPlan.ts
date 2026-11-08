/**
 * Logique PURE de synchronisation (sans Firestore) : validation, permissions, fusion.
 * Le client envoie des « effets » (ce qui a changé localement) ; le serveur les rejoue de façon
 * idempotente dans une transaction. Testable sans émulateur.
 */
import {Permission} from "./permissions";

export const TENANT_COLLS = ["settings", "categories", "customers", "suppliers", "products"] as const;
export const BRANCH_COLLS = [
  "stockMovements", "sales", "purchases", "expenses", "debts", "reservations",
  "reservationPayments", "reservationCancellations", "reservationDeliveries",
  "stockDamages", "freeIssues",
] as const;
export const ALL_COLLS: readonly string[] = [...TENANT_COLLS, ...BRANCH_COLLS];
const DELETABLE = ["products", "categories"];
const CREATE_ONLY = [
  "stockMovements", "sales", "purchases", "expenses", "reservationPayments",
  "reservationDeliveries", "stockDamages", "freeIssues",
];

export interface Upsert {c: string; id: string; doc: Record<string, any>}
export interface Del {c: string; id: string}
export interface StockDelta {productId: string; delta: number}
export interface BalanceDelta {c: "customers" | "suppliers"; id: string; delta: number}
export interface Effects {
  upserts: Upsert[]; deletes: Del[]; stockDeltas: StockDelta[]; balanceDeltas: BalanceDelta[];
}

export class SyncRejection extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_UNITS = 300;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function reject(msg: string): never {
  throw new SyncRejection(msg);
}

export function validateEffects(raw: any): Effects {
  const arr = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : reject("Format invalide."));
  const e: Effects = {
    upserts: arr(raw?.upserts), deletes: arr(raw?.deletes),
    stockDeltas: arr(raw?.stockDeltas), balanceDeltas: arr(raw?.balanceDeltas),
  };
  const total = e.upserts.length + e.deletes.length + e.stockDeltas.length + e.balanceDeltas.length;
  if (total === 0) reject("Opération vide.");
  if (total > MAX_UNITS) reject("Opération trop volumineuse.");
  if (e.balanceDeltas.length) reject("Les soldes sont calculés côté serveur.");
  for (const u of e.upserts) {
    if (!ALL_COLLS.includes(u?.c) || !ID_RE.test(String(u?.id)) || typeof u.doc !== "object" || u.doc === null) {
      reject("Enregistrement invalide.");
    }
    if (u.doc.id !== u.id) reject("Identifiant incohérent.");
    if (JSON.stringify(u.doc).length > 100_000) reject("Enregistrement trop volumineux.");
    checkJson(u.doc, 0);
  }
  for (const d of e.deletes) {
    if (!DELETABLE.includes(d?.c) || !ID_RE.test(String(d?.id))) reject("Suppression non autorisée.");
  }
  for (const s of e.stockDeltas) {
    if (!ID_RE.test(String(s?.productId)) || !num(s.delta) || s.delta === 0 || Math.abs(s.delta) > 1e7) {
      reject("Variation de stock invalide.");
    }
  }
  for (const b of e.balanceDeltas) {
    if (!["customers", "suppliers"].includes(b?.c) || !ID_RE.test(String(b?.id)) || !num(b.delta) ||
      b.delta === 0 || Math.abs(b.delta) > 1e9) reject("Variation de solde invalide.");
  }
  return e;
}

function checkJson(v: unknown, depth: number) {
  if (depth > 8) reject("Enregistrement trop profond.");
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) reject("Nombre invalide."); return;
  }
  if (Array.isArray(v)) {
    v.forEach((x) => checkJson(x, depth + 1)); return;
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as object)) {
      if (k.startsWith("__") || k.includes("/")) reject("Champ interdit.");
      checkJson(x, depth + 1);
    }
    return;
  }
  reject("Type non pris en charge.");
}

// ---------- permissions ----------

const WRITE_PERMS: Record<string, Permission[]> = {
  settings: ["branch.settings"], categories: ["stock.manage"], products: ["stock.manage"],
  customers: ["customers.manage"], suppliers: ["suppliers.manage"],
  sales: ["sales.create"], purchases: ["purchases.create"], expenses: ["expenses.create"],
  debts: ["debts.pay", "sales.create", "purchases.create"],
  stockMovements: ["stock.manage", "sales.create", "purchases.create"],
  reservations: ["sales.create"], reservationPayments: ["sales.create"],
  reservationCancellations: ["sales.create", "sales.cancel"], reservationDeliveries: ["sales.create"],
  stockDamages: ["stock.manage"], freeIssues: ["stock.manage"],
};
const NEG_STOCK: Permission[] = ["sales.create", "stock.manage", "purchases.create"];
const POS_STOCK: Permission[] = ["stock.manage", "purchases.create", "sales.cancel"];

/** Renvoie la première exigence non satisfaite (liste « l'une de »), ou null. */
export function missingPermission(e: Effects, perms: ReadonlySet<string>): Permission[] | null {
  const need: Permission[][] = [];
  for (const u of e.upserts) need.push(WRITE_PERMS[u.c]);
  for (const d of e.deletes) need.push(WRITE_PERMS[d.c]);
  if (e.stockDeltas.some((s) => s.delta < 0)) need.push(NEG_STOCK);
  if (e.stockDeltas.some((s) => s.delta > 0)) need.push(POS_STOCK);
  for (const b of e.balanceDeltas) {
    need.push(b.c === "customers" ?
      ["sales.create", "debts.pay", "customers.manage", "sales.cancel"] :
      ["purchases.create", "debts.pay", "suppliers.manage"]);
  }
  return need.find((anyOf) => !anyOf.some((p) => perms.has(p))) ?? null;
}

// ---------- chemins ----------

export const docPath = (t: string, b: string, c: string, id: string) =>
  (TENANT_COLLS as readonly string[]).includes(c) ?
    `tenants/${t}/${c}/${id}` : `tenants/${t}/branches/${b}/${c}/${id}`;
export const stockPath = (t: string, b: string, productId: string) =>
  `tenants/${t}/branches/${b}/stock/${productId}`;
// '~' is excluded from accepted operation/document identifiers, so this tuple encoding is unambiguous.
export const tombstoneId = (opId: string, c: string, id: string) => `${opId}~${c}~${id}`;
export const tombstonePath = (t: string, opId: string, c: string, id: string) =>
  `tenants/${t}/tombstones/${tombstoneId(opId, c, id)}`;
const tombstoneHeadPath = (t: string, c: string, id: string) =>
  `tenants/${t}/tombstoneHeads/${c}_${id}`;

export function pathsToRead(t: string, b: string, e: Effects, opId = ""):
  string[] {
  const s = new Set<string>();
  e.upserts.forEach((u) => s.add(docPath(t, b, u.c, u.id)));
  for (const u of e.upserts) {
    const d = u.doc as Record<string, any>;
    if (u.c === "sales" && typeof d.customerId === "string") s.add(docPath(t, b, "customers", d.customerId));
    if (u.c === "purchases" && typeof d.supplierId === "string") s.add(docPath(t, b, "suppliers", d.supplierId));
    if (u.c === "debts" && typeof d.partyId === "string") s.add(docPath(t, b, d.type === "SUPPLIER" ? "suppliers" : "customers", d.partyId));
    if ((u.c === "sales" || u.c === "purchases") && Array.isArray(d.items)) {
      for (const item of d.items) if (typeof item?.productId === "string") s.add(docPath(t, b, "products", item.productId));
    }
  }
  e.upserts.filter((u) => DELETABLE.includes(u.c)).forEach((u) => s.add(tombstoneHeadPath(t, u.c, u.id)));
  e.deletes.forEach((d) => {
    s.add(docPath(t, b, d.c, d.id));
    s.add(tombstoneHeadPath(t, d.c, d.id));
    if (opId) s.add(tombstonePath(t, opId, d.c, d.id));
  });
  e.stockDeltas.forEach((x) => s.add(stockPath(t, b, x.productId)));
  e.balanceDeltas.forEach((x) => s.add(docPath(t, b, x.c, x.id)));
  return [...s];
}

// ---------- validation métier d'une nouvelle vente ----------

export function validateNewSale(d: Record<string, any>) {
  if (!Array.isArray(d.items) || d.items.length === 0) reject("Vente sans article.");
  let sub = 0;
  for (const it of d.items) {
    if (typeof it?.productId !== "string" || !ID_RE.test(it.productId) ||
      !num(it?.quantity) || it.quantity <= 0 || !num(it?.unitPriceUSD) || it.unitPriceUSD < 0) {
      reject("Ligne de vente invalide.");
    }
    const line = r2(it.quantity * it.unitPriceUSD);
    if (it.totalUSD !== undefined && (!num(it.totalUSD) || Math.abs(it.totalUSD - line) > 0.02)) reject("Ligne de vente incohérente.");
    sub = r2(sub + line);
  }
  if (!num(d.exchangeRate) || d.exchangeRate < 100 || d.exchangeRate > 100000) reject("Taux de vente invalide.");
  if (d.subtotalUSD !== undefined && (!num(d.subtotalUSD) || Math.abs(d.subtotalUSD - sub) > 0.02)) reject("Sous-total incohérent.");
  const discount = d.discountUSD ?? 0;
  if (!num(discount) || discount < 0 || discount > sub + 0.02) reject("Remise invalide.");
  const total = r2(Math.max(0, sub - discount));
  if (!num(d.totalUSD) || Math.abs(d.totalUSD - total) > 0.02) reject("Total de vente incohérent.");
  if (!num(d.amountPaidUSD) || d.amountPaidUSD < 0 || d.amountPaidUSD > total + 0.02) reject("Montant payé invalide.");
  const debt = r2(Math.max(0, total - d.amountPaidUSD));
  if (!num(d.debtAmountUSD) || Math.abs(d.debtAmountUSD - debt) > 0.02) reject("Dette de vente incohérente.");
  if (debt > 0.01 && !d.customerId) reject("Vente à crédit sans client.");
  if (d.customerId !== undefined && (typeof d.customerId !== "string" || !ID_RE.test(d.customerId))) reject("Client de vente invalide.");
  if (d.status !== undefined && d.status !== "COMPLETED") reject("Statut de vente invalide.");
  if (d.totalCDF !== undefined && (!num(d.totalCDF) || Math.abs(d.totalCDF - Math.round(total * d.exchangeRate)) > 1)) reject("Total CDF incohérent.");
  if (d.amountPaidCDF !== undefined && (!num(d.amountPaidCDF) || Math.abs(d.amountPaidCDF - Math.round(d.amountPaidUSD * d.exchangeRate)) > 1)) reject("Paiement CDF incohérent.");
}

export function validateNewPurchase(d: Record<string, any>) {
  if (typeof d.supplierId !== "string" || !ID_RE.test(d.supplierId) || !Array.isArray(d.items) || d.items.length === 0) reject("Achat invalide.");
  if (!num(d.exchangeRate) || d.exchangeRate < 100 || d.exchangeRate > 100000) reject("Taux d'achat invalide.");
  let subtotal = 0;
  for (const it of d.items) {
    if (typeof it?.productId !== "string" || !ID_RE.test(it.productId) || !num(it.quantity) || it.quantity <= 0 || !num(it.buyPriceUSD) || it.buyPriceUSD < 0) reject("Ligne d'achat invalide.");
    const line = r2(it.quantity * it.buyPriceUSD);
    if (it.totalUSD !== undefined && (!num(it.totalUSD) || Math.abs(it.totalUSD - line) > 0.02)) reject("Ligne d'achat incohérente.");
    subtotal = r2(subtotal + line);
  }
  const fees = d.additionalFeesUSD ?? 0;
  if (!num(fees) || fees < 0 || (d.subtotalUSD !== undefined && (!num(d.subtotalUSD) || Math.abs(d.subtotalUSD - subtotal) > 0.02))) reject("Frais ou sous-total d'achat invalides.");
  const total = r2(subtotal + fees);
  if (!num(d.totalUSD) || Math.abs(d.totalUSD - total) > 0.02 || !num(d.amountPaidUSD) || d.amountPaidUSD < 0 || d.amountPaidUSD > total + 0.02) reject("Montants d'achat incohérents.");
  const debt = r2(total - Math.min(total, d.amountPaidUSD));
  if (!num(d.debtAmountUSD) || Math.abs(d.debtAmountUSD - debt) > 0.02) reject("Dette d'achat incohérente.");
}

export function validateSettings(id: string, d: Record<string, any>) {
  if (id !== "general") reject("Paramètres invalides.");
  const rate = d.exchangeRate;
  if (!num(rate) || rate < 100 || rate > 100000) reject("Taux de change invalide.");
  if (d.primaryCurrency !== undefined && !["USD", "CDF"].includes(d.primaryCurrency)) reject("Devise invalide.");
}

// ---------- fusion ----------

export interface PlanResult {sets: Map<string, any>; deletes: string[]; notes: string[]}

export function plan(
  t: string, b: string, e: Effects, existing: ReadonlyMap<string, any>, at: number, version: number,
  opId = "legacy", actorUid = ""
): PlanResult {
  const sets = new Map<string, any>();
  const deletes: string[] = [];
  const notes: string[] = [];
  const cur = (p: string) => (sets.has(p) ? sets.get(p) : existing.get(p));
  const changeBalance = (c: "customers" | "suppliers", id: string, delta: number) => {
    const p = docPath(t, b, c, id);
    const doc = cur(p);
    if (!doc) reject(`Compte ${c}/${id} introuvable.`);
    const field = c === "customers" ? "debtBalanceUSD" : "balanceDueUSD";
    const current = Number(doc[field] ?? 0);
    if (!num(current) || current < 0) reject("Solde serveur invalide.");
    const next = r2(current + delta);
    if (next < -0.01 || !num(next)) reject("Solde calculé invalide.");
    sets.set(p, {...doc, [field]: Math.max(0, next), serverVersion: version});
  };

  for (const u of e.upserts) {
    const p = docPath(t, b, u.c, u.id);
    const prev = existing.get(p);
    const tombstone = DELETABLE.includes(u.c) ? existing.get(tombstoneHeadPath(t, u.c, u.id)) : undefined;
    if (!prev && tombstone) {
      notes.push(`DELETED ${u.c}/${u.id}`);
      continue;
    }
    const doc: Record<string, any> = {...u.doc};
    delete doc.syncStatus;

    if (prev && CREATE_ONLY.includes(u.c)) {
      notes.push(`DUPLICATE ${u.c}/${u.id}`); continue;
    }
    if (u.c === "settings") validateSettings(u.id, doc);
    if (!prev && u.c === "sales") {
      validateNewSale(doc);
      if (doc.customerId && !cur(docPath(t, b, "customers", doc.customerId))) reject("Client de vente introuvable.");
      for (const item of doc.items) if (!cur(docPath(t, b, "products", item.productId))) reject("Produit de vente introuvable.");
      if (doc.debtAmountUSD > 0.01) changeBalance("customers", doc.customerId, r2(doc.debtAmountUSD));
    }
    if (!prev && u.c === "purchases") {
      validateNewPurchase(doc);
      if (!cur(docPath(t, b, "suppliers", doc.supplierId))) reject("Fournisseur d'achat introuvable.");
      for (const item of doc.items) if (!cur(docPath(t, b, "products", item.productId))) reject("Produit d'achat introuvable.");
      if (doc.debtAmountUSD > 0.01) changeBalance("suppliers", doc.supplierId, r2(doc.debtAmountUSD));
    }
    if (prev && typeof prev._at === "number" && prev._at > at && u.c !== "debts") {
      notes.push(`STALE ${u.c}/${u.id}`);
      continue;
    }

    if (u.c === "customers") doc.debtBalanceUSD = prev?.debtBalanceUSD ?? 0;
    if (u.c === "suppliers") doc.balanceDueUSD = prev?.balanceDueUSD ?? 0;
    if (u.c === "products") delete doc.currentStock;
    if (actorUid && CREATE_ONLY.includes(u.c)) {
      const localName = u.c === "sales" ? doc.cashierName : u.c === "purchases" ? doc.createdByName :
        u.c === "expenses" ? doc.createdBy : u.c === "stockMovements" ? doc.userName : null;
      const localId = u.c === "sales" ? doc.cashierId : u.c === "purchases" ? doc.createdById :
        u.c === "expenses" ? doc.createdById : u.c === "stockMovements" ? doc.userId : null;
      doc.authenticatedActorUid = actorUid;
      doc.localActorClaim = {id: typeof localId === "string" ? localId : null, name: typeof localName === "string" ? localName : null};
      doc.localActorVerified = false;
    }

    if (u.c === "debts" && prev) {
      if (doc.type !== prev.type || doc.partyId !== prev.partyId ||
        doc.referenceInvoice !== prev.referenceInvoice || doc.initialAmountUSD !== prev.initialAmountUSD) {
        reject("Les données d'origine d'une dette sont immuables.");
      }
      const hist = new Map<string, any>();
      for (const h of prev.history ?? []) hist.set(h.id, h);
      let newPayments = 0;
      for (const h of doc.history ?? []) {
        if (typeof h?.id !== "string" || !ID_RE.test(h.id)) reject("Paiement de dette invalide.");
        if (!hist.has(h.id)) {
          if (!num(h.amountUSD) || h.amountUSD <= 0 || h.amountUSD > 1e9 || !Number.isFinite(Date.parse(h.date)) ||
            !num(h.exchangeRate) || h.exchangeRate < 100 || h.exchangeRate > 100000 ||
            (h.amountCDF !== undefined && (!num(h.amountCDF) || Math.abs(h.amountCDF - Math.round(h.amountUSD * h.exchangeRate)) > 1))) reject("Paiement de dette invalide.");
          hist.set(h.id, {...h, authenticatedActorUid: actorUid,
            localActorClaim: {id: null, name: typeof h.recordedBy === "string" ? h.recordedBy : null},
            localActorVerified: false});
          newPayments = r2(newPayments + h.amountUSD);
        }
      }
      const history = [...hist.values()].sort((x, y) => String(x.date).localeCompare(String(y.date)));
      const paid = r2(history.reduce((s, h) => s + (num(h.amountUSD) ? h.amountUSD : 0), 0));
      if (!num(doc.initialAmountUSD) || doc.initialAmountUSD <= 0 || paid > doc.initialAmountUSD + 0.01) reject("Les paiements dépassent le montant initial de la dette.");
      doc.history = history;
      doc.paidAmountUSD = paid;
      doc.remainingBalanceUSD = r2(Math.max(0, (num(doc.initialAmountUSD) ? doc.initialAmountUSD : prev.initialAmountUSD) - paid));
      doc.lastPaymentDate = history.length ? history[history.length - 1].date : doc.lastPaymentDate;
      if (newPayments > 0) {
        if (doc.type !== "CUSTOMER" && doc.type !== "SUPPLIER") reject("Type de dette invalide.");
        changeBalance(doc.type === "CUSTOMER" ? "customers" : "suppliers", doc.partyId, -newPayments);
        doc.lastUpdatedByFirebaseUid = actorUid;
      }
    } else if (u.c === "debts" && !prev) {
      if ((doc.type !== "CUSTOMER" && doc.type !== "SUPPLIER") || !num(doc.initialAmountUSD) || doc.initialAmountUSD <= 0 ||
        !Array.isArray(doc.history) || doc.history.length !== 0 || !num(doc.remainingBalanceUSD) ||
        Math.abs(doc.remainingBalanceUSD - doc.initialAmountUSD) > 0.01) reject("Nouvelle dette invalide.");
      const matched = e.upserts.some((x) => {
        if (x.c === "sales") {
          return doc.type === "CUSTOMER" && x.doc.invoiceNumber === doc.referenceInvoice &&
            x.doc.customerId === doc.partyId && Math.abs(Number(x.doc.debtAmountUSD) - doc.initialAmountUSD) < 0.02;
        }
        if (x.c === "purchases") {
          return doc.type === "SUPPLIER" && x.doc.purchaseNumber === doc.referenceInvoice &&
            x.doc.supplierId === doc.partyId && Math.abs(Number(x.doc.debtAmountUSD) - doc.initialAmountUSD) < 0.02;
        }
        return false;
      });
      if (!matched) reject("Une dette doit référencer une vente ou un achat validé.");
    }
    sets.set(p, {...doc, _at: Math.max(at, prev?._at ?? 0), serverVersion: version});
  }

  for (const d of e.deletes) {
    const p = docPath(t, b, d.c, d.id);
    const prev = existing.get(p);
    const head = existing.get(tombstoneHeadPath(t, d.c, d.id));
    if ((prev && typeof prev._at === "number" && prev._at > at) ||
      (head && typeof head._at === "number" && head._at > at)) {
      notes.push(`STALE_DELETE ${d.c}/${d.id}`); continue;
    }
    if (prev) deletes.push(p);
    sets.delete(p);
    // Tombstones are durable audit records. They are never physically removed by sync;
    // safe compaction requires a server maintained acknowledgement watermark for every device.
    sets.set(tombstonePath(t, opId, d.c, d.id), {
      id: tombstoneId(opId, d.c, d.id), tenantId: t, branchId: null,
      collection: d.c, documentId: d.id, operationId: opId,
      deletedAt: new Date(version), _at: at, serverVersion: version,
    });
    sets.set(tombstoneHeadPath(t, d.c, d.id), {
      id: d.id, tenantId: t, branchId: null, collection: d.c,
      documentId: d.id, operationId: opId, deletedAt: new Date(version),
      _at: at, serverVersion: version,
    });
  }

  for (const x of e.balanceDeltas) {
    const p = docPath(t, b, x.c, x.id);
    const doc = cur(p);
    if (!doc) {
      notes.push(`BALANCE_TARGET_MISSING ${x.c}/${x.id}`); continue;
    }
    const f = x.c === "customers" ? "debtBalanceUSD" : "balanceDueUSD";
    sets.set(p, {...doc, [f]: r2(Math.max(0, (doc[f] ?? 0) + x.delta)), serverVersion: version});
  }

  // Une vente réelle n'est jamais refusée pour stock insuffisant : on accepte et on signale.
  const byProduct = new Map<string, number>();
  for (const s of e.stockDeltas) byProduct.set(s.productId, (byProduct.get(s.productId) ?? 0) + s.delta);
  for (const [productId, delta] of byProduct) {
    const p = stockPath(t, b, productId);
    const prev = cur(p) ?? {id: productId, productId, currentStock: 0};
    const next = r6((prev.currentStock ?? 0) + delta);
    if (next < 0) notes.push(`NEGATIVE_STOCK ${productId}`);
    sets.set(p, {...prev, currentStock: next, negative: next < 0, serverVersion: version});
  }
  return {sets, deletes, notes};
}
