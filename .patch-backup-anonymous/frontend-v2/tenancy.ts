import { Preferences } from '@capacitor/preferences';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';
import { callFunction } from './functionsClient';

export type TenantRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface Membership { tenantId: string; name: string; role: TenantRole; active: boolean }
export interface Branch { id: string; name: string }
export interface ActiveContext { tenantId: string; branchId: string | null }

const CONTEXT_KEY = 'bta_active_context_v1';
const MEMBERSHIPS_KEY = 'bta_memberships_cache_v1';

/** Correspondance des rôles locaux actuels vers les rôles d'entreprise (sans casser l'existant). */
export function localRoleToTenantRole(role: 'ADMIN' | 'GESTIONNAIRE'): TenantRole {
  return role === 'ADMIN' ? 'OWNER' : 'MANAGER';
}

export function newRequestId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ----- contexte actif (conservé hors ligne) -----

export async function getActiveContext(): Promise<ActiveContext | null> {
  try {
    const { value } = await Preferences.get({ key: CONTEXT_KEY });
    return value ? (JSON.parse(value) as ActiveContext) : null;
  } catch { return null; }
}

export async function setActiveContext(ctx: ActiveContext | null): Promise<void> {
  if (!ctx) await Preferences.remove({ key: CONTEXT_KEY });
  else await Preferences.set({ key: CONTEXT_KEY, value: JSON.stringify(ctx) });
}

// ----- lectures Firestore (autorisées par les règles) -----

export async function listMemberships(uid: string): Promise<Membership[]> {
  try {
    const { snapshots } = await FirebaseFirestore.getCollection({ reference: `userMemberships/${uid}/tenants` });
    const list: Membership[] = snapshots
      .filter((s) => s.data && (s.data as any).active !== false)
      .map((s) => ({
        tenantId: s.id,
        name: String((s.data as any).name ?? ''),
        role: (s.data as any).role as TenantRole,
        active: true,
      }));
    await Preferences.set({ key: MEMBERSHIPS_KEY, value: JSON.stringify(list) });
    return list;
  } catch {
    // Hors ligne ou erreur : dernière liste connue.
    const { value } = await Preferences.get({ key: MEMBERSHIPS_KEY });
    return value ? (JSON.parse(value) as Membership[]) : [];
  }
}

export async function listBranches(tenantId: string): Promise<Branch[]> {
  const { branches } = await callFunction<{ branches: Branch[] }>('listAccessibleBranches', { tenantId });
  return branches;
}

export const assertBranchAccess = (tenantId: string, branchId: string) =>
  callFunction<{ ok: true }>('assertBranchAccess', { tenantId, branchId });

export const getBranchPermissions = (tenantId: string, branchId: string) =>
  callFunction<{ role: TenantRole; permissions: string[] }>('getBranchPermissions', { tenantId, branchId });

// ----- actions serveur -----

export const createTenant = (companyName: string, branchName: string, clientRequestId: string) =>
  callFunction<{ tenantId: string; branchId: string }>('createTenant', { companyName, branchName, clientRequestId });

export const createBranch = (tenantId: string, name: string) =>
  callFunction<{ branchId: string }>('createBranch', { tenantId, name });

export const inviteMember = (
  tenantId: string, email: string, role: TenantRole,
  branches: { branchId: string; role: TenantRole; permissions?: string[] }[],
) => callFunction<{ invitationId: string; code: string }>('inviteMember', { tenantId, email, role, branches });

/** `code` = « tenantId.invitationId » fourni par l'invitant. */
export function acceptInvitation(code: string) {
  const [tenantId, invitationId] = code.trim().split('.');
  if (!tenantId || !invitationId) throw new Error('Code d’invitation invalide.');
  return callFunction<{ tenantId: string }>('acceptInvitation', { tenantId, invitationId });
}

export const setBranchAccess = (
  tenantId: string, uid: string, branchId: string, role: TenantRole | null, permissions?: string[],
) => callFunction<{ ok: true }>('setBranchAccess', { tenantId, uid, branchId, role, permissions });

export const deactivateMember = (tenantId: string, uid: string) =>
  callFunction<{ ok: true }>('deactivateMember', { tenantId, uid });
