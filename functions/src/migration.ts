import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {initializeApp, getApps} from "firebase-admin/app";

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const callOpts = {region: "africa-south1", cors: true, timeoutSeconds: 120};

/** Collections importables : chemin relatif (tenant ou établissement). */
const TENANT_COLLECTIONS = ["settings", "categories", "customers", "suppliers", "products"] as const;
const BRANCH_COLLECTIONS = [
  "stock", "stockMovements", "sales", "purchases", "expenses", "debts",
  "reservations", "reservationPayments", "reservationCancellations",
  "reservationDeliveries", "stockDamages", "freeIssues",
] as const;
type Coll = (typeof TENANT_COLLECTIONS)[number] | (typeof BRANCH_COLLECTIONS)[number];

const MAX_DOCS_PER_CALL = 200;
const MAX_DOC_BYTES = 200_000;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

function bad(msg: string): never {
  throw new HttpsError("invalid-argument", msg);
}

function clean(v: unknown, depth = 0): unknown {
  if (depth > 8) bad("Document trop profond.");
  if (v === undefined) return null;
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : bad("Nombre invalide.");
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k.startsWith("__") || k.includes("/")) bad("Nom de champ interdit.");
      out[k] = clean(x, depth + 1);
    }
    return out;
  }
  return bad("Type de valeur non pris en charge.");
}

async function requireOwner(uid: string, tenantId: string) {
  const m = await db.doc(`tenants/${tenantId}/members/${uid}`).get();
  if (!m.exists || m.data()?.role !== "OWNER" || m.data()?.active !== true) {
    throw new HttpsError("permission-denied", "Migration réservée au propriétaire.");
  }
}

function args(req: {data: any}) {
  const tenantId = String(req.data?.tenantId ?? "");
  const branchId = String(req.data?.branchId ?? "");
  const migrationId = String(req.data?.migrationId ?? "");
  if (![tenantId, branchId, migrationId].every((s) => ID_RE.test(s))) bad("Paramètres invalides.");
  return {tenantId, branchId, migrationId};
}

/**
 * Importe un lot de documents. Idempotent : rejouer le même lot réécrit les mêmes documents.
 * Un document déjà présent mais créé par une autre migration ou par une opération réelle
 * n'est jamais écrasé.
 */
export const migrationImport = onCall(callOpts, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const {tenantId, branchId, migrationId} = args(req);
  await requireOwner(req.auth.uid, tenantId);

  const collection = req.data?.collection as Coll;
  const isTenant = (TENANT_COLLECTIONS as readonly string[]).includes(collection);
  const isBranch = (BRANCH_COLLECTIONS as readonly string[]).includes(collection);
  if (!isTenant && !isBranch) bad("Collection inconnue.");

  const docs = req.data?.docs;
  if (!Array.isArray(docs) || docs.length === 0 || docs.length > MAX_DOCS_PER_CALL) {
    bad(`Lot de 1 à ${MAX_DOCS_PER_CALL} documents.`);
  }

  const mig = await db.doc(`tenants/${tenantId}/migrations/${migrationId}`).get();
  if (mig.exists && mig.data()?.status === "COMPLETE") {
    throw new HttpsError("failed-precondition", "Cette migration est déjà terminée.");
  }
  const br = await db.doc(`tenants/${tenantId}/branches/${branchId}`).get();
  if (!br.exists) throw new HttpsError("not-found", "Établissement introuvable.");

  const base = isTenant ? `tenants/${tenantId}/${collection}` : `tenants/${tenantId}/branches/${branchId}/${collection}`;
  const prepared = docs.map((d: any) => {
    const docId = String(d?.id ?? "");
    if (!ID_RE.test(docId)) bad("Identifiant de document invalide.");
    const data = clean(d) as Record<string, unknown>;
    if (JSON.stringify(data).length > MAX_DOC_BYTES) bad("Document trop volumineux.");
    return {ref: db.doc(`${base}/${docId}`), data};
  });
  if (new Set(prepared.map((p) => p.ref.path)).size !== prepared.length) bad("Identifiants en double.");

  const existing = await db.getAll(...prepared.map((p) => p.ref));
  const batch = db.batch();
  let written = 0;
  let skipped = 0;
  existing.forEach((snap, i) => {
    const prev = snap.data();
    if (snap.exists && prev?.migrationId !== migrationId) {
      skipped++;
      return;
    }
    batch.set(prepared[i].ref, {
      ...prepared[i].data, migrationId, migratedBy: req.auth!.uid, migratedAt: FieldValue.serverTimestamp(),
      _at: 0, serverVersion: Date.now(),
    });
    written++;
  });
  await batch.commit();

  // Compteurs par collection (rejeu : on stocke le dernier décompte reçu, pas une somme).
  return {written, skipped};
});

/**
 * Clôture : compare les totaux envoyés par l'appareil aux documents réellement présents.
 * Refuse de clôturer au moindre écart.
 */
export const migrationFinalize = onCall(callOpts, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const {tenantId, branchId, migrationId} = args(req);
  await requireOwner(req.auth.uid, tenantId);

  const expected = req.data?.expected as Record<string, number> | undefined;
  if (!expected || typeof expected !== "object") bad("Totaux attendus manquants.");

  const migRef = db.doc(`tenants/${tenantId}/migrations/${migrationId}`);
  const mismatches: Record<string, {expected: number; found: number}> = {};
  for (const c of [...TENANT_COLLECTIONS, ...BRANCH_COLLECTIONS]) {
    const want = expected[c];
    if (typeof want !== "number" || want < 0) bad(`Total manquant : ${c}.`);
    const path = (TENANT_COLLECTIONS as readonly string[]).includes(c) ?
      `tenants/${tenantId}/${c}` : `tenants/${tenantId}/branches/${branchId}/${c}`;
    const agg = await db.collection(path).where("migrationId", "==", migrationId).count().get();
    const found = agg.data().count;
    if (found !== want) mismatches[c] = {expected: want, found};
  }
  if (Object.keys(mismatches).length > 0) {
    await migRef.set({status: "FAILED", mismatches, at: FieldValue.serverTimestamp()}, {merge: true});
    throw new HttpsError("data-loss", `Écarts détectés : ${JSON.stringify(mismatches)}`);
  }
  await migRef.set({
    status: "COMPLETE", branchId, expected, by: req.auth.uid, at: FieldValue.serverTimestamp(),
  });
  await db.collection(`tenants/${tenantId}/auditLogs`).add({
    action: "LOCAL_DATA_MIGRATED", actorUid: req.auth.uid, details: {migrationId, branchId, expected},
    at: FieldValue.serverTimestamp(),
  });
  return {status: "COMPLETE"};
});
