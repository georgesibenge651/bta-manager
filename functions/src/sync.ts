import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldPath} from "firebase-admin/firestore";
import {initializeApp, getApps} from "firebase-admin/app";
import {Permission, ROLE_DEFAULTS, isRole} from "./permissions";
import {
  validateEffects, missingPermission, pathsToRead, plan, SyncRejection, operationReplay, ALL_COLLS, TENANT_COLLS,
} from "./syncPlan";

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const callOpts = {region: "africa-south1", cors: true, timeoutSeconds: 120};
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_OPS = 10;
const PAGE = 300;

function idArg(v: unknown, f: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new HttpsError("invalid-argument", `${f} invalide.`);
  return v;
}

/** Permissions du demandeur dans l'établissement ; refuse tout non-membre de façon uniforme. */
async function branchPerms(uid: string, t: string, b: string): Promise<{perms: Set<Permission>; role: string}> {
  const m = await db.doc(`tenants/${t}/members/${uid}`).get();
  const md = m.data();
  if (!m.exists || !md || md.active !== true || !isRole(md.role)) {
    throw new HttpsError("permission-denied", "Accès refusé.");
  }
  const br = await db.doc(`tenants/${t}/branches/${b}`).get();
  if (!br.exists || br.data()?.active === false) throw new HttpsError("permission-denied", "Accès refusé.");
  if (md.role === "OWNER") return {perms: new Set(ROLE_DEFAULTS.OWNER), role: md.role};
  const a = await db.doc(`tenants/${t}/members/${uid}/branchAccess/${b}`).get();
  if (!a.exists) throw new HttpsError("permission-denied", "Accès refusé.");
  return {perms: new Set((a.data()?.permissions ?? []) as Permission[]), role: md.role};
}

export const syncOperations = onCall(callOpts, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const uid = req.auth.uid;
  const t = idArg(req.data?.tenantId, "tenantId");
  const b = idArg(req.data?.branchId, "branchId");
  const ops = req.data?.ops;
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS) {
    throw new HttpsError("invalid-argument", `1 à ${MAX_OPS} opérations.`);
  }
  const {perms} = await branchPerms(uid, t, b);
  const results: {opId: string; status: string; reason?: string; notes?: string[]}[] = [];

  for (const op of ops) {
    const opId = idArg(op?.opId, "opId");
    const now = Date.now();
    // Horodatage client borné : jamais dans le futur, jamais absurdement ancien.
    const at = Math.min(now, Math.max(now - 366 * 24 * 3600 * 1000, Number(op?.createdAt) || now));
    const opRef = db.doc(`tenants/${t}/branches/${b}/operations/${opId}`);

    try {
      const effects = validateEffects(op?.effects);
      const missing = missingPermission(effects, perms);
      if (missing) throw new SyncRejection(`Permission manquante (${missing.join(" ou ")}).`);

      const res = await db.runTransaction(async (tx) => {
        const prior = await tx.get(opRef);
        if (prior.exists) {
          const replay = operationReplay(prior.data());
          if (replay) return replay;
        }
        const paths = pathsToRead(t, b, effects, opId);
        const snaps = paths.length ? await tx.getAll(...paths.map((p) => db.doc(p))) : [];
        const existing = new Map<string, any>();
        snaps.forEach((s, i) => {
          if (s.exists) existing.set(paths[i], s.data());
        });

        const version = Date.now();
        const out = plan(t, b, effects, existing, at, version, opId, uid);
        for (const [p, data] of out.sets) tx.set(db.doc(p), data);
        for (const p of out.deletes) tx.delete(db.doc(p));
        tx.set(opRef, {status: "APPLIED", actorUid: uid, at, serverVersion: version, notes: out.notes});
        return {status: "APPLIED", notes: out.notes};
      });
      results.push({opId, ...res});
    } catch (e) {
      if (e instanceof SyncRejection) {
        // Refus définitif et mémorisé : un rejeu renverra le même verdict sans rien écrire d'autre.
        // create() échoue si l'opération existe déjà (ex. appliquée avant un changement de droits) :
        // dans ce cas on renvoie le verdict d'origine.
        try {
          await opRef.create({status: "REJECTED", actorUid: uid, at, reason: e.message});
          results.push({opId, status: "REJECTED", reason: e.message});
        } catch {
          const prior = (await opRef.get()).data();
          if (prior?.status === "APPLIED") {
            results.push({opId, status: "DUPLICATE", notes: prior.notes ?? []});
          } else {
            results.push({opId, status: "REJECTED", reason: prior?.reason ?? e.message});
          }
        }
      } else {
        throw e; // erreur technique : le client réessaiera, l'idempotence protège
      }
    }
  }
  return {results};
});

const READ_PERM: Record<string, Permission | null> = {
  stock: "stock.read", stockMovements: "stock.read", stockDamages: "stock.read", freeIssues: "stock.read",
  sales: "sales.read", reservations: "sales.read", reservationPayments: "sales.read",
  reservationCancellations: "sales.read", reservationDeliveries: "sales.read",
  purchases: "purchases.read", expenses: "expenses.read", debts: "debts.read",
};
const HIDDEN = new Set(["migratedAt", "migratedBy", "migrationId", "_at"]);

/** Lecture paginée des changements d'une collection depuis un point de reprise. */
export const pullChanges = onCall(callOpts, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const t = idArg(req.data?.tenantId, "tenantId");
  const b = idArg(req.data?.branchId, "branchId");
  const c = String(req.data?.collection ?? "");
  const since = req.data?.since === undefined ? 0 : Number(req.data.since);
  if (!Number.isFinite(since) || since < 0) throw new HttpsError("invalid-argument", "Curseur since invalide.");
  const hasVersion = req.data?.afterVersion !== undefined;
  const hasId = req.data?.afterId !== undefined;
  if (hasVersion !== hasId) throw new HttpsError("invalid-argument", "Curseur incomplet.");
  const afterVersion = hasVersion ? Number(req.data.afterVersion) : null;
  const afterId = hasId ? idArg(req.data.afterId, "afterId") : null;
  if (afterVersion !== null && (!Number.isFinite(afterVersion) || afterVersion < since)) {
    throw new HttpsError("invalid-argument", "Curseur afterVersion invalide.");
  }
  const isTenant = (TENANT_COLLS as readonly string[]).includes(c);
  const isTombstoneFeed = c === "__tombstones";
  if (!isTombstoneFeed && !isTenant && !(c in READ_PERM) && !ALL_COLLS.includes(c)) {
    throw new HttpsError("invalid-argument", "Collection inconnue.");
  }
  const {perms} = await branchPerms(req.auth.uid, t, b);
  if (!isTenant && !isTombstoneFeed) {
    const need = READ_PERM[c];
    if (!need || !perms.has(need)) throw new HttpsError("permission-denied", "Accès refusé.");
  }
  const path = isTombstoneFeed ? `tenants/${t}/tombstones` :
    isTenant ? `tenants/${t}/${c}` : `tenants/${t}/branches/${b}/${c}`;
  let q = db.collection(path).where("serverVersion", ">", since)
    .orderBy("serverVersion").orderBy(FieldPath.documentId()).limit(PAGE);
  if (afterVersion !== null && afterId !== null) q = q.startAfter(afterVersion, afterId);
  const snap = await q.get();
  const docs = snap.docs.map((d) => {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d.data())) if (!HIDDEN.has(k)) data[k] = v;
    return {id: d.id, data};
  });
  return {docs, hasMore: snap.size === PAGE, serverTime: Date.now()};
});
