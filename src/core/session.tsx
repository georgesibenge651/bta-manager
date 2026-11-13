import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { appRepository } from '../db/storage';
import { clearCoreToken, coreBranches, coreBranchPermissions, coreLogin, coreLogout, coreMe, CoreApiError, CoreBranch, CoreMembership, CoreMe, CoreRole, getCoreToken, setCoreToken } from './api';
import { CoreSignIn } from './signIn';
import { Preferences } from '@capacitor/preferences';

const CONTEXT_KEY = 'bta_core_context_v1';
const CACHED_SESSION_KEY = 'bta_core_session_cache_v1';
export interface CoreSessionValue {
  me: CoreMe; membership: CoreMembership; branch: CoreBranch; branches: CoreBranch[]; permissions: string[];
  selectBranch(id: number): Promise<void>; signOut(): Promise<void>; refresh(): Promise<void>;
}
const Context = createContext<CoreSessionValue | null>(null);
export const useCoreSession = () => useContext(Context);

export function CoreSessionGate({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<CoreMe | null>(null);
  const [membership, setMembership] = useState<CoreMembership | null>(null);
  const [branches, setBranches] = useState<CoreBranch[]>([]);
  const [branch, setBranch] = useState<CoreBranch | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setBusy(true); setError('');
    try {
      if (!(await getCoreToken())) { setMe(null); return; }
      const identity = await coreMe(); setMe(identity);
      const { value } = await Preferences.get({ key: CONTEXT_KEY });
      const saved = value ? JSON.parse(value) as { tenantId: number; branchId: number } : null;
      const m = identity.memberships.find(x => x.tenantId === saved?.tenantId) ?? identity.memberships[0];
      if (!m) { setMembership(null); setBranches([]); setBranch(null); return; }
      setMembership(m);
      const br = await coreBranches(m.tenantId);
      const activeBranches = br.branches.filter(x => x.status === 'ACTIVE');
      const accessResults = await Promise.all(activeBranches.map(async item => {
        try {
          const access = await coreBranchPermissions(m.tenantId, item.id);
          return access.role === m.role && access.permissions.length > 0 ? { branch: item, access } : null;
        } catch (error) {
          if (error instanceof CoreApiError && (error.status === 0 || error.status >= 500 || error.status === 401)) throw error;
          return null;
        }
      }));
      const authorized = accessResults.filter((item): item is NonNullable<typeof item> => item !== null);
      const selectedAccess = authorized.find(x => x.branch.id === saved?.branchId) ?? authorized[0];
      const selected = selectedAccess?.branch;
      setBranches(authorized.map(x => x.branch));
      setBranch(selected ?? null);
      if (selected && selectedAccess) {
        const branchPermissions = selectedAccess.access;
        await appRepository.bootstrapCoreData(m.tenantId, selected.id, branchPermissions.permissions);
        setPermissions(branchPermissions.permissions);
        await Preferences.set({ key: CONTEXT_KEY, value: JSON.stringify({ tenantId: m.tenantId, branchId: selected.id }) });
        appRepository.activateCoreUser({ id: identity.user.id, name: identity.user.name, email: identity.user.email, role: m.role, tenantId: m.tenantId, branchId: selected.id });
        await Preferences.set({ key: CACHED_SESSION_KEY, value: JSON.stringify({ me: identity, membership: m, branches: authorized.map(x => x.branch), branch: selected, permissions: branchPermissions.permissions }) });
      }
    } catch (e) {
      const apiError = e as { status?: number };
      if (apiError.status === 0 || (apiError.status !== undefined && apiError.status >= 500)) {
        try {
          const cached = await Preferences.get({ key: CACHED_SESSION_KEY });
          const session = cached.value ? JSON.parse(cached.value) as { me:CoreMe; membership:CoreMembership; branches:CoreBranch[]; branch:CoreBranch; permissions:string[] } : null;
          if (session && Date.parse(session.me.session_expires_at) > Date.now()) {
            await appRepository.bootstrapCoreData(session.membership.tenantId, session.branch.id, session.permissions);
            appRepository.activateCoreUser({ id: session.me.user.id, name: session.me.user.name, email: session.me.user.email, role: session.membership.role, tenantId: session.membership.tenantId, branchId: session.branch.id });
            setMe(session.me); setMembership(session.membership); setBranches(session.branches); setBranch(session.branch); setPermissions(session.permissions);
            setError('Session en cache : le serveur est indisponible. Les écritures restent en file locale.');
            return;
          }
        } catch { /* fall through to the visible network error */ }
      }
      setMe(null); setMembership(null); setBranches([]); setBranch(null); setPermissions([]);
      setError(e instanceof Error ? e.message : 'Connexion au Core impossible.');
      if (apiError.status === 401) { await clearCoreToken(); await Preferences.remove({ key: CACHED_SESSION_KEY }); }
    }
    finally { setBusy(false); }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    const onUnauthorized = (event: Event) => { const detail = (event as CustomEvent).detail; void Preferences.remove({ key: CACHED_SESSION_KEY }); appRepository.logout(); setMe(null); setMembership(null); setBranches([]); setBranch(null); setPermissions([]); setError(`Session expirée — requête: ${detail?.path ?? 'inconnue'} | HTTP ${detail?.status ?? 401} | ${detail?.code ?? 'unknown'}`); };
    window.addEventListener('bta-core-unauthorized', onUnauthorized);
    return () => window.removeEventListener('bta-core-unauthorized', onUnauthorized);
  }, []);

  const signIn = async (email: string, password: string) => {
    await Preferences.remove({ key: CACHED_SESSION_KEY });
    const result = await coreLogin(email, password); await setCoreToken(result.token); await refresh();
  };
  const signOut = async () => {
    try { if (await getCoreToken()) await coreLogout(); } finally { await clearCoreToken(); await Preferences.remove({ key: CACHED_SESSION_KEY }); appRepository.logout(); setMe(null); setMembership(null); setBranch(null); setPermissions([]); }
  };
  const selectBranch = async (id: number) => {
    const selected = branches.find(x => x.id === id);
    if (!selected || !membership) throw new Error('Établissement indisponible.');
    const access = await coreBranchPermissions(membership.tenantId, id);
    if (access.role !== membership.role) throw new Error('Le rôle de session ne correspond pas aux droits Core.');
    await appRepository.bootstrapCoreData(membership.tenantId, id, access.permissions);
    await Preferences.set({ key: CONTEXT_KEY, value: JSON.stringify({ tenantId: membership.tenantId, branchId: id }) });
    setPermissions(access.permissions);
    setBranch(selected);
    appRepository.activateCoreUser({ id: me!.user.id, name: me!.user.name, email: me!.user.email, role: membership.role, tenantId: membership.tenantId, branchId: id });
    await Preferences.set({ key: CACHED_SESSION_KEY, value: JSON.stringify({ me, membership, branches, branch: selected, permissions: access.permissions }) });
  };

  const value = useMemo(() => me && membership && branch ? { me, membership, branch, branches, permissions, selectBranch, signOut, refresh } : null,
    [me, membership, branch, branches, permissions]);
  if (busy) return <div className="min-h-screen grid place-items-center">Connexion à Fondation Kenda Core…</div>;
  if (!me) return <CoreSignIn onSignIn={signIn} error={error} />;
  if (!membership) return <CoreSignIn onSignIn={signIn} error="Ce compte n’appartient à aucune entreprise active." />;
  if (!branches.length || !branch) return <CoreSignIn onSignIn={signIn} error="Aucun établissement actif n’est disponible pour cette entreprise." />;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function roleToLocal(role: CoreRole): 'ADMIN' | 'GESTIONNAIRE' | 'CASHIER' {
  if (role === 'OWNER' || role === 'ADMIN') return 'ADMIN';
  return role === 'MANAGER' ? 'GESTIONNAIRE' : 'CASHIER';
}
