/**
 * Modèle de rôles et de permissions de BTA Manager (multi-entreprises).
 *
 * - Rôle d'entreprise (members/{uid}.role) : OWNER | ADMIN | MANAGER | CASHIER
 * - Affectation par établissement (members/{uid}/branchAccess/{branchId}) :
 *   un rôle + une liste PLATE de permissions (lue telle quelle par les règles Firestore).
 * - Le propriétaire (OWNER) a accès à tous les établissements sans affectation.
 */

export const ROLES = ["OWNER", "ADMIN", "MANAGER", "CASHIER"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "sales.read",
  "sales.create",
  "sales.cancel",
  "stock.read",
  "stock.manage",
  "purchases.read",
  "purchases.create",
  "debts.read",
  "debts.pay",
  "expenses.read",
  "expenses.create",
  "customers.read",
  "customers.manage",
  "suppliers.read",
  "suppliers.manage",
  "cashbox.manage",
  "reports.read",
  "audit.read",
  "branch.settings",
  "members.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  MANAGER: [
    "sales.read", "sales.create", "sales.cancel",
    "stock.read", "stock.manage",
    "purchases.read", "purchases.create",
    "debts.read", "debts.pay",
    "expenses.read", "expenses.create",
    "customers.read", "customers.manage",
    "suppliers.read", "suppliers.manage",
    "cashbox.manage", "reports.read",
  ],
  CASHIER: [
    "sales.read", "sales.create",
    "stock.read",
    "customers.read",
    "debts.read",
    "debts.pay",
    "cashbox.manage",
  ],
};

/** Niveau hiérarchique : on ne peut accorder qu'un rôle strictement inférieur au sien. */
const RANK: Record<Role, number> = {OWNER: 4, ADMIN: 3, MANAGER: 2, CASHIER: 1};

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);
}

/** Rôle que `granter` a le droit d'attribuer à quelqu'un d'autre. */
export function canGrantRole(granter: Role, target: Role): boolean {
  if (target === "OWNER") return false; // un seul propriétaire, transfert hors périmètre
  return RANK[granter] > RANK[target];
}

/**
 * Permissions effectives d'une affectation.
 * `requested` absent → permissions par défaut du rôle.
 * Sinon on garde l'intersection avec les permissions déjà détenues par celui qui accorde
 * (anti-escalade) et on ne dépasse jamais le plafond du rôle attribué.
 */
export function resolvePermissions(
  targetRole: Role,
  requested: unknown,
  granterPermissions: ReadonlySet<Permission>
): Permission[] {
  const ceiling = new Set(ROLE_DEFAULTS[targetRole]);
  const base = Array.isArray(requested) ?
    requested.filter(isPermission) :
    ROLE_DEFAULTS[targetRole];
  const out = new Set<Permission>();
  for (const p of base) {
    if (ceiling.has(p) && granterPermissions.has(p)) out.add(p);
  }
  // Seul un propriétaire/administrateur peut déléguer la gestion des membres.
  if (targetRole !== "ADMIN") out.delete("members.manage");
  return [...out].sort();
}
