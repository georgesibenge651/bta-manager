import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import {getFirestore, FieldValue, Firestore, Transaction} from "firebase-admin/firestore";
import {initializeApp, getApps} from "firebase-admin/app";
import {
  Role, Permission, ROLE_DEFAULTS, PERMISSIONS, isRole, canGrantRole, resolvePermissions,
} from "./permissions";

if (getApps().length === 0) initializeApp();
const db: Firestore = getFirestore();

const MAX_TENANTS_PER_USER = 3;
const MAX_BRANCHES_PER_TENANT = 25;
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const callOpts = {region: "africa-south1", enforceAppCheck: false, cors: true};

// ---------- utilitaires ----------

function requireAuth(req: CallableRequest): {uid: string; email: string | null; verified: boolean} {
  if (!req.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  return {
    uid: req.auth.uid,
    email: (req.auth.token.email as string | undefined)?.toLowerCase() ?? null,
    verified: req.auth.token.email_verified === true,
  };
}

function str(v: unknown, field: string, min = 1, max = 120): string {
  if (typeof v !== "string") throw new HttpsError("invalid-argument", `${field} invalide.`);
  const s = v.trim();
  if (s.length < min || s.length > max) {
    throw new HttpsError("invalid-argument", `${field} : ${min}–${max} caractères.`);
  }
  return s;
}

function id(v: unknown, field: string): string {
  const s = str(v, field, 1, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new HttpsError("invalid-argument", `${field} invalide.`);
  return s;
}

interface Caller {
  uid: string;
  role: Role;
  active: boolean;
}

async function loadCaller(tx: Transaction, tenantId: string, uid: string): Promise<Caller> {
  const snap = await tx.get(db.doc(`tenants/${tenantId}/members/${uid}`));
  const d = snap.data();
  // Même message pour « tenant inexistant » et « non-membre » : pas de fuite d'existence.
  if (!snap.exists || !d || d.active !== true || !isRole(d.role)) {
    throw new HttpsError("permission-denied", "Accès refusé.");
  }
  return {uid, role: d.role, active: true};
}

/** Permissions détenues par le demandeur dans un établissement (OWNER = toutes). */
async function callerPermissions(
  tx: Transaction, tenantId: string, caller: Caller, branchId: string
): Promise<Set<Permission>> {
  if (caller.role === "OWNER") return new Set(ROLE_DEFAULTS.OWNER);
  const snap = await tx.get(
    db.doc(`tenants/${tenantId}/members/${caller.uid}/branchAccess/${branchId}`)
  );
  const perms = snap.data()?.permissions;
  return new Set(Array.isArray(perms) ? (perms as Permission[]) : []);
}

function audit(
  tx: Transaction, tenantId: string, uid: string, action: string, details: Record<string, unknown>
) {
  tx.set(db.collection(`tenants/${tenantId}/auditLogs`).doc(), {
    action, actorUid: uid, details, at: FieldValue.serverTimestamp(),
  });
}

async function assertBranchExists(tx: Transaction, tenantId: string, branchId: string) {
  const b = await tx.get(db.doc(`tenants/${tenantId}/branches/${branchId}`));
  if (!b.exists || b.data()?.active === false) {
    throw new HttpsError("not-found", "Établissement introuvable.");
  }
}

// ---------- création d'entreprise ----------

export const createTenant = onCall(callOpts, async (req) => {
  const {uid, email} = requireAuth(req);
  const companyName = str(req.data?.companyName, "Nom de l'entreprise", 2, 100);
  const branchName = str(req.data?.branchName ?? "Établissement principal", "Nom de l'établissement", 2, 100);
  const requestId = id(req.data?.clientRequestId, "clientRequestId");

  return db.runTransaction(async (tx) => {
    // Idempotence : un rejeu (réseau coupé) renvoie la même entreprise.
    const reqRef = db.doc(`creationRequests/${uid}_${requestId}`);
    const prior = await tx.get(reqRef);
    if (prior.exists) return prior.data();

    const mine = await tx.get(
      db.collection(`userMemberships/${uid}/tenants`).where("role", "==", "OWNER")
    );
    if (mine.size >= MAX_TENANTS_PER_USER) {
      throw new HttpsError("resource-exhausted", "Nombre maximal d'entreprises atteint.");
    }

    const tenantRef = db.collection("tenants").doc();
    const branchRef = tenantRef.collection("branches").doc();
    const tenantId = tenantRef.id;

    tx.set(tenantRef, {
      name: companyName, ownerUid: uid, active: true, createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(branchRef, {name: branchName, active: true, createdAt: FieldValue.serverTimestamp()});
    tx.set(tenantRef.collection("members").doc(uid), {
      role: "OWNER", active: true, email, createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.doc(`userMemberships/${uid}/tenants/${tenantId}`), {
      role: "OWNER", name: companyName, active: true,
    });
    audit(tx, tenantId, uid, "TENANT_CREATED", {companyName, branchId: branchRef.id});

    const result = {tenantId, branchId: branchRef.id};
    tx.set(reqRef, result);
    return result;
  });
});

// ---------- établissements ----------

export const createBranch = onCall(callOpts, async (req) => {
  const {uid} = requireAuth(req);
  const tenantId = id(req.data?.tenantId, "tenantId");
  const name = str(req.data?.name, "Nom de l'établissement", 2, 100);

  return db.runTransaction(async (tx) => {
    const caller = await loadCaller(tx, tenantId, uid);
    if (caller.role !== "OWNER") {
      throw new HttpsError("permission-denied", "Réservé au propriétaire.");
    }
    const count = await tx.get(db.collection(`tenants/${tenantId}/branches`).count());
    if (count.data().count >= MAX_BRANCHES_PER_TENANT) {
      throw new HttpsError("resource-exhausted", "Nombre maximal d'établissements atteint.");
    }
    const ref = db.collection(`tenants/${tenantId}/branches`).doc();
    tx.set(ref, {name, active: true, createdAt: FieldValue.serverTimestamp()});
    audit(tx, tenantId, uid, "BRANCH_CREATED", {branchId: ref.id, name});
    return {branchId: ref.id};
  });
});

// ---------- invitations ----------

interface BranchGrant {branchId: string; role: Role; permissions: Permission[]}

async function parseGrants(
  tx: Transaction, tenantId: string, caller: Caller, raw: unknown
): Promise<BranchGrant[]> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 25) {
    throw new HttpsError("invalid-argument", "Au moins un établissement est requis.");
  }
  const seen = new Set<string>();
  const out: BranchGrant[] = [];
  for (const g of raw) {
    const branchId = id(g?.branchId, "branchId");
    if (seen.has(branchId)) throw new HttpsError("invalid-argument", "Établissement en double.");
    seen.add(branchId);
    if (!isRole(g?.role)) throw new HttpsError("invalid-argument", "Rôle invalide.");
    if (!canGrantRole(caller.role, g.role)) {
      throw new HttpsError("permission-denied", "Vous ne pouvez pas attribuer ce rôle.");
    }
    await assertBranchExists(tx, tenantId, branchId);
    const mine = await callerPermissions(tx, tenantId, caller, branchId);
    if (!mine.has("members.manage")) {
      throw new HttpsError("permission-denied", "Gestion des membres non autorisée ici.");
    }
    out.push({branchId, role: g.role, permissions: resolvePermissions(g.role, g.permissions, mine)});
  }
  return out;
}

export const inviteMember = onCall(callOpts, async (req) => {
  const {uid} = requireAuth(req);
  const tenantId = id(req.data?.tenantId, "tenantId");
  const email = str(req.data?.email, "E-mail", 5, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "E-mail invalide.");
  }
  const tenantRole = req.data?.role;
  if (!isRole(tenantRole)) throw new HttpsError("invalid-argument", "Rôle invalide.");

  return db.runTransaction(async (tx) => {
    const caller = await loadCaller(tx, tenantId, uid);
    if (!canGrantRole(caller.role, tenantRole)) {
      throw new HttpsError("permission-denied", "Vous ne pouvez pas attribuer ce rôle.");
    }
    const grants = await parseGrants(tx, tenantId, caller, req.data?.branches);
    const ref = db.collection(`tenants/${tenantId}/invitations`).doc();
    tx.set(ref, {
      email, role: tenantRole, branches: grants, status: "PENDING", invitedBy: uid,
      createdAt: FieldValue.serverTimestamp(), expiresAt: Date.now() + INVITE_TTL_MS,
    });
    audit(tx, tenantId, uid, "MEMBER_INVITED", {email, role: tenantRole, invitationId: ref.id});
    return {invitationId: ref.id, code: `${tenantId}.${ref.id}`};
  });
});

export const acceptInvitation = onCall(callOpts, async (req) => {
  const {uid, email, verified} = requireAuth(req);
  const tenantId = id(req.data?.tenantId, "tenantId");
  const invitationId = id(req.data?.invitationId, "invitationId");
  if (!email || !verified) {
    throw new HttpsError("failed-precondition", "E-mail non vérifié.");
  }

  return db.runTransaction(async (tx) => {
    const invRef = db.doc(`tenants/${tenantId}/invitations/${invitationId}`);
    const inv = await tx.get(invRef);
    const d = inv.data();
    // Message unique : ne révèle pas si l'invitation existe pour quelqu'un d'autre.
    if (!inv.exists || !d || d.status !== "PENDING" || d.email !== email || d.expiresAt < Date.now()) {
      throw new HttpsError("permission-denied", "Invitation invalide ou expirée.");
    }
    const memberRef = db.doc(`tenants/${tenantId}/members/${uid}`);
    const existing = await tx.get(memberRef);
    if (existing.exists && existing.data()?.role === "OWNER") {
      throw new HttpsError("failed-precondition", "Déjà propriétaire.");
    }
    const tenant = await tx.get(db.doc(`tenants/${tenantId}`));

    tx.set(memberRef, {
      role: d.role, active: true, email, invitedBy: d.invitedBy,
      createdAt: existing.exists ? existing.data()?.createdAt : FieldValue.serverTimestamp(),
    });
    for (const g of d.branches as BranchGrant[]) {
      tx.set(db.doc(`tenants/${tenantId}/members/${uid}/branchAccess/${g.branchId}`), {
        role: g.role, permissions: g.permissions, grantedBy: d.invitedBy,
      });
    }
    tx.set(db.doc(`userMemberships/${uid}/tenants/${tenantId}`), {
      role: d.role, name: tenant.data()?.name ?? "", active: true,
    });
    tx.update(invRef, {status: "ACCEPTED", acceptedBy: uid, acceptedAt: FieldValue.serverTimestamp()});
    audit(tx, tenantId, uid, "INVITATION_ACCEPTED", {invitationId});
    return {tenantId};
  });
});

// ---------- affectations ----------

/** Crée, modifie (role + permissions) ou retire (role = null) l'accès d'un membre à un établissement. */
export const setBranchAccess = onCall(callOpts, async (req) => {
  const {uid} = requireAuth(req);
  const tenantId = id(req.data?.tenantId, "tenantId");
  const targetUid = id(req.data?.uid, "uid");
  const branchId = id(req.data?.branchId, "branchId");
  const revoke = req.data?.role === null;
  if (!revoke && !isRole(req.data?.role)) throw new HttpsError("invalid-argument", "Rôle invalide.");

  return db.runTransaction(async (tx) => {
    const caller = await loadCaller(tx, tenantId, uid);
    await assertBranchExists(tx, tenantId, branchId);
    const mine = await callerPermissions(tx, tenantId, caller, branchId);
    if (!mine.has("members.manage")) {
      throw new HttpsError("permission-denied", "Accès refusé.");
    }
    const targetSnap = await tx.get(db.doc(`tenants/${tenantId}/members/${targetUid}`));
    const target = targetSnap.data();
    if (!targetSnap.exists || !target || !isRole(target.role)) {
      throw new HttpsError("not-found", "Membre introuvable.");
    }
    if (target.role === "OWNER" || targetUid === uid) {
      throw new HttpsError("permission-denied", "Cette affectation ne peut pas être modifiée.");
    }
    // On ne touche pas à quelqu'un de rang égal ou supérieur.
    if (!canGrantRole(caller.role, target.role)) {
      throw new HttpsError("permission-denied", "Accès refusé.");
    }
    const accessRef = db.doc(`tenants/${tenantId}/members/${targetUid}/branchAccess/${branchId}`);
    if (revoke) {
      tx.delete(accessRef);
    } else {
      const role = req.data.role as Role;
      if (!canGrantRole(caller.role, role)) {
        throw new HttpsError("permission-denied", "Vous ne pouvez pas attribuer ce rôle.");
      }
      tx.set(accessRef, {
        role, permissions: resolvePermissions(role, req.data?.permissions, mine), grantedBy: uid,
      });
    }
    audit(tx, tenantId, uid, revoke ? "BRANCH_ACCESS_REVOKED" : "BRANCH_ACCESS_SET",
      {targetUid, branchId, role: revoke ? null : req.data.role});
    return {ok: true};
  });
});

/** Désactive un membre (ses données et son historique restent). */
export const deactivateMember = onCall(callOpts, async (req) => {
  const {uid} = requireAuth(req);
  const tenantId = id(req.data?.tenantId, "tenantId");
  const targetUid = id(req.data?.uid, "uid");
  return db.runTransaction(async (tx) => {
    const caller = await loadCaller(tx, tenantId, uid);
    const targetSnap = await tx.get(db.doc(`tenants/${tenantId}/members/${targetUid}`));
    const target = targetSnap.data();
    if (!targetSnap.exists || !target || !isRole(target.role) || targetUid === uid) {
      throw new HttpsError("failed-precondition", "Opération impossible.");
    }
    if (!canGrantRole(caller.role, target.role)) {
      throw new HttpsError("permission-denied", "Accès refusé.");
    }
    tx.update(targetSnap.ref, {active: false});
    tx.set(db.doc(`userMemberships/${targetUid}/tenants/${tenantId}`), {active: false}, {merge: true});
    audit(tx, tenantId, uid, "MEMBER_DEACTIVATED", {targetUid});
    return {ok: true};
  });
});

/** Returns only active establishments assigned to the authenticated member. */
export const listAccessibleBranches = onCall(callOpts, async (req) => {
  const {uid} = requireAuth(req);
  const tenantId = id(req.data?.tenantId, "tenantId");
  const member = await db.doc(`tenants/${tenantId}/members/${uid}`).get();
  const md = member.data();
  if (!member.exists || !md || md.active !== true || !isRole(md.role)) {
    throw new HttpsError("permission-denied", "Accès refusé.");
  }
  const branches = await db.collection(`tenants/${tenantId}/branches`).get();
  if (md.role === "OWNER") {
    return {branches: branches.docs.filter((b) => b.data().active !== false)
      .map((b) => ({id: b.id, name: String(b.data().name ?? "")}))};
  }
  const grants = await db.collection(`tenants/${tenantId}/members/${uid}/branchAccess`).get();
  const permitted = new Set(grants.docs.map((g) => g.id));
  return {branches: branches.docs.filter((b) => b.data().active !== false && permitted.has(b.id))
    .map((b) => ({id: b.id, name: String(b.data().name ?? "")}))};
});

/** Explicit server-side check before a device changes its active company branch. */
export const assertBranchAccess = onCall(callOpts, async (req) => {
  const {uid} = requireAuth(req);
  const tenantId = id(req.data?.tenantId, "tenantId");
  const branchId = id(req.data?.branchId, "branchId");
  const caller = await loadCallerForBranch(tenantId, uid, branchId);
  return {ok: !!caller};
});

/** Authoritative effective permissions for rendering the current branch UI. */
export const getBranchPermissions = onCall(callOpts, async (req) => {
  const {uid} = requireAuth(req);
  const tenantId = id(req.data?.tenantId, "tenantId");
  const branchId = id(req.data?.branchId, "branchId");
  const member = await db.doc(`tenants/${tenantId}/members/${uid}`).get();
  const md = member.data();
  if (!member.exists || !md || md.active !== true || !isRole(md.role)) throw new HttpsError("permission-denied", "Accès refusé.");
  await assertBranchForMember(uid, tenantId, branchId, md.role);
  if (md.role === "OWNER") return {role: md.role, permissions: ROLE_DEFAULTS.OWNER};
  const access = await db.doc(`tenants/${tenantId}/members/${uid}/branchAccess/${branchId}`).get();
  const permissions = access.data()?.permissions;
  return {role: md.role, permissions: Array.isArray(permissions) ? permissions.filter((p): p is Permission => PERMISSIONS.includes(p)) : []};
});

async function assertBranchForMember(uid: string, tenantId: string, branchId: string, role: Role) {
  const branch = await db.doc(`tenants/${tenantId}/branches/${branchId}`).get();
  if (!branch.exists || branch.data()?.active === false) throw new HttpsError("permission-denied", "Accès refusé.");
  if (role !== "OWNER") {
    const access = await db.doc(`tenants/${tenantId}/members/${uid}/branchAccess/${branchId}`).get();
    if (!access.exists) throw new HttpsError("permission-denied", "Accès refusé.");
  }
}

async function loadCallerForBranch(tenantId: string, uid: string, branchId: string) {
  const m = await db.doc(`tenants/${tenantId}/members/${uid}`).get();
  const md = m.data();
  if (!m.exists || !md || md.active !== true || !isRole(md.role)) throw new HttpsError("permission-denied", "Accès refusé.");
  const branch = await db.doc(`tenants/${tenantId}/branches/${branchId}`).get();
  if (!branch.exists || branch.data()?.active === false) throw new HttpsError("permission-denied", "Accès refusé.");
  if (md.role === "OWNER") return true;
  const access = await db.doc(`tenants/${tenantId}/members/${uid}/branchAccess/${branchId}`).get();
  if (!access.exists) throw new HttpsError("permission-denied", "Accès refusé.");
  return true;
}
