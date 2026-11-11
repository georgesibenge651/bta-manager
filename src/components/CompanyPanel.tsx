import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Mail, KeyRound, Store } from 'lucide-react';
import { getFirebaseUser } from '../firebase/auth';
import { migrateLocalData, isMigrated } from '../db/migration';
import { appRepository } from '../db/storage';
import {
  Membership, Branch, TenantRole, listMemberships, listBranches, createTenant, createBranch,
  inviteMember, inviteAnonymousManager, acceptInvitation, getActiveContext, setActiveContext, newRequestId, assertBranchAccess,
} from '../firebase/tenancy';

const ROLE_LABEL: Record<TenantRole, string> = {
  OWNER: 'Propriétaire', ADMIN: 'Administrateur', MANAGER: 'Gestionnaire', CASHIER: 'Caissier',
};

/** Onglet « Entreprise » : création, établissements, invitations. Exige une connexion Firebase. */
export const CompanyPanel: React.FC = () => {
  const [uid, setUid] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [joinBranchId, setJoinBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [branchName, setBranchName] = useState('Établissement principal');
  const [newBranch, setNewBranch] = useState('');
  const [code, setCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TenantRole>('CASHIER');
  const [inviteBranch, setInviteBranch] = useState('');
  const [lastCode, setLastCode] = useState('');
  const [lastAnonymousCode, setLastAnonymousCode] = useState('');
  const [migrated, setMigrated] = useState(false);
  const [progress, setProgress] = useState('');
  // Un identifiant par tentative de création : un rejeu réseau ne crée pas de doublon.
  const [requestId, setRequestId] = useState(newRequestId);

  const current = memberships.find((m) => m.tenantId === tenantId) || null;
  const canManage = current?.role === 'OWNER' || current?.role === 'ADMIN';

  const refresh = useCallback(async (u: string) => {
    const list = await listMemberships(u);
    setMemberships(list);
    const ctx = await getActiveContext();
    const pick = list.find((m) => m.tenantId === ctx?.tenantId) || list[0] || null;
    setTenantId(pick ? pick.tenantId : null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const account = await getFirebaseUser();
        if (!account) { setErr('Connectez d’abord votre compte Firebase (écran de verrouillage).'); return; }
        setUid(account.uid);
        await refresh(account.uid);
      } catch (e) { setErr(e instanceof Error ? e.message : 'Firebase indisponible.'); }
    })();
  }, [refresh]);

  useEffect(() => {
    if (tenantId) isMigrated(tenantId).then(setMigrated).catch(() => setMigrated(false));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) { setBranches([]); return; }
    listBranches(tenantId).then((b) => { setBranches(b); setInviteBranch(b[0]?.id ?? ''); setJoinBranchId(''); }).catch(() => { setBranches([]); setJoinBranchId(''); });
  }, [tenantId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur.'); } finally { setBusy(false); }
  };

  const doCreateTenant = () => run(async () => {
    const r = await createTenant(companyName, branchName, requestId);
    setRequestId(newRequestId());
    await setActiveContext({ tenantId: r.tenantId, branchId: r.branchId });
    setCompanyName('');
    setMsg('Entreprise créée.');
    if (uid) await refresh(uid);
  });

  const doAccept = () => run(async () => {
    const r = await acceptInvitation(code);
    await setActiveContext({ tenantId: r.tenantId, branchId: null });
    setCode(''); setMsg('Invitation acceptée.');
    if (uid) await refresh(uid);
  });

  const doCreateBranch = () => run(async () => {
    if (!tenantId) return;
    await createBranch(tenantId, newBranch);
    setNewBranch(''); setBranches(await listBranches(tenantId)); setMsg('Établissement créé.');
  });

  const doMigrate = () => run(async () => {
    if (!tenantId || branches.length !== 1) throw new Error('Un seul établissement est attendu pour cette migration.');
    const r = await migrateLocalData(tenantId, branches[0].id, (p) => setProgress(`${p.collection} : ${p.done}/${p.total}`));
    appRepository.enableCloudSync(tenantId, branches[0].id);
    setMigrated(true); setProgress('');
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    setMsg(`Migration terminée et vérifiée : ${total} enregistrements. Vos données locales sont conservées.`);
  });

  const doJoin = () => run(async () => {
    if (!tenantId || !joinBranchId || !branches.some((b) => b.id === joinBranchId)) throw new Error('Choisissez un établissement auquel votre compte a accès.');
    await assertBranchAccess(tenantId, joinBranchId);
    if (!window.confirm('Les données commerciales actuellement sur ce téléphone (y compris les données de démonstration) seront remplacées par celles de l’entreprise. Continuer ?')) return;
    appRepository.joinCloudAsNewDevice(tenantId, joinBranchId);
    await setActiveContext({ tenantId, branchId: joinBranchId });
    setMsg('Appareil connecté. Téléchargement des données en cours…');
  });

  const switchBranch = (branchId: string) => run(async () => {
    if (!tenantId || !branches.some((b) => b.id === branchId)) throw new Error('Établissement non autorisé.');
    await assertBranchAccess(tenantId, branchId);
    if (!window.confirm('Les données déjà synchronisées de cet appareil seront remplacées par les données de l’établissement choisi. Continuer ?')) return;
    appRepository.switchCloudContext(tenantId, branchId);
    await setActiveContext({ tenantId, branchId });
    setMsg('Changement d’établissement lancé. Téléchargement des données en cours…');
  });

  const doInvite = () => run(async () => {
    if (!tenantId || !inviteBranch) throw new Error('Choisissez un établissement.');
    const r = await inviteMember(tenantId, inviteEmail, inviteRole, [{ branchId: inviteBranch, role: inviteRole }]);
    setLastCode(r.code); setInviteEmail(''); setMsg('Invitation créée. Transmettez le code ci-dessous.');
  });

  const doInviteAnonymousManager = () => run(async () => {
    if (!tenantId || !inviteBranch) throw new Error('Choisissez un établissement.');
    const result = await inviteAnonymousManager(tenantId, [{ branchId: inviteBranch }]);
    setLastAnonymousCode(result.code);
    setMsg('Invitation gestionnaire créée. Transmettez ce code à Didier.');
  });

  const input = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-xs';
  const btn = 'px-3 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1';

  return (
    <div className="space-y-4 text-xs">
      {err && <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-800 font-bold">{err}</div>}
      {msg && <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">{msg}</div>}

      {uid && (
        <>
          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <h3 className="font-extrabold flex items-center gap-2"><Building2 className="w-4 h-4" /> Mes entreprises</h3>
            {memberships.length === 0 && <p className="text-slate-500">Aucune entreprise. Créez-en une ou acceptez une invitation.</p>}
            {memberships.map((m) => (
              <button key={m.tenantId} type="button" disabled={busy}
                onClick={() => { setTenantId(m.tenantId); void setActiveContext({ tenantId: m.tenantId, branchId: null }); }}
                className={`w-full text-left p-3 rounded-xl border ${m.tenantId === tenantId ? 'border-sky-500 bg-sky-50' : 'border-slate-200'}`}>
                <b>{m.name}</b> · {ROLE_LABEL[m.role] ?? m.role}
              </button>
            ))}
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <h3 className="font-extrabold flex items-center gap-2"><Plus className="w-4 h-4" /> Créer une entreprise</h3>
            <input className={input} placeholder="Nom de l’entreprise" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            <input className={input} placeholder="Premier établissement" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
            <button className={btn} disabled={busy || companyName.trim().length < 2} onClick={doCreateTenant}>Créer</button>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <h3 className="font-extrabold flex items-center gap-2"><KeyRound className="w-4 h-4" /> J’ai un code d’invitation</h3>
            <input className={input} placeholder="Code reçu" value={code} onChange={(e) => setCode(e.target.value)} />
            <p className="text-slate-500">Votre e-mail Firebase doit être vérifié et identique à celui invité.</p>
            <button className={btn} disabled={busy || !code.includes('.')} onClick={doAccept}>Rejoindre</button>
          </div>

          {current && (
            <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
              <h3 className="font-extrabold flex items-center gap-2"><Store className="w-4 h-4" /> Établissements de {current.name}</h3>
              {branches.map((b) => <div key={b.id} className="p-2 rounded-xl bg-slate-50 flex items-center justify-between gap-2">
                <span>{b.name}</span>
                {appRepository.isCloudEnabled() && <button className="text-sky-700 font-bold disabled:text-slate-400"
                  disabled={busy || appRepository.getCloudContext()?.tenantId === tenantId && appRepository.getCloudContext()?.branchId === b.id}
                  onClick={() => switchBranch(b.id)}>Utiliser ici</button>}
              </div>)}
              {current.role === 'OWNER' && (
                <div className="flex gap-2">
                  <input className={input} placeholder="Nouvel établissement" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
                  <button className={btn} disabled={busy || newBranch.trim().length < 2} onClick={doCreateBranch}>Ajouter</button>
                </div>
              )}
            </div>
          )}

          {current && current.role === 'OWNER' && branches.length === 1 && (
            <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 space-y-2">
              <h3 className="font-extrabold">Envoyer les données de cet appareil</h3>
              <p className="text-slate-600">
                Produits, clients, ventes, dettes, stock… seront copiés vers « {branches[0].name} ».
                Rien n’est supprimé sur ce téléphone. Gardez une connexion stable ; en cas de coupure, relancez : l’envoi reprend sans doublon.
              </p>
              {migrated ? <p className="font-bold text-emerald-700">✔ Déjà migré.</p> :
                <button className={btn} disabled={busy} onClick={doMigrate}>{busy ? 'Envoi en cours…' : 'Lancer la migration'}</button>}
              {progress && <p className="font-mono">{progress}</p>}
            </div>
          )}

          {current && !migrated && !appRepository.isCloudEnabled() && (
            <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
              <h3 className="font-extrabold">Nouvel appareil de cette entreprise</h3>
              <p className="text-slate-600">Si les données de l’entreprise sont déjà en ligne, téléchargez-les sur ce téléphone.</p>
              <select className={input} value={joinBranchId} onChange={(e) => setJoinBranchId(e.target.value)}>
                <option value="">Choisissez un établissement accessible</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className={btn} disabled={busy || !joinBranchId} onClick={doJoin}>Télécharger les données</button>
            </div>
          )}

          {appRepository.isCloudEnabled() && (
            <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-1">
              <h3 className="font-extrabold">Synchronisation active</h3>
              <p className="text-slate-600">Les ventes, stocks et dettes sont envoyés automatiquement et fonctionnent hors connexion.</p>
              {appRepository.getSyncRejections().slice(0, 5).map((r) => (
                <div key={r.id} className="text-red-700 font-bold flex items-start justify-between gap-2">
                  <p>⚠ {new Date(r.at).toLocaleString()} — {r.reason}</p>
                  <button className="underline shrink-0" onClick={() => {
                    if (window.confirm('Réessayer cette opération avec un nouvel identifiant ? Vérifiez d’abord que les données ou les permissions ont été corrigées.')) {
                      try { appRepository.retryRejectedOperation(r.id); } catch (e) { setErr(e instanceof Error ? e.message : 'Réessai impossible.'); }
                    }
                  }}>Réessayer</button>
                </div>
              ))}
            </div>
          )}

          {current && canManage && (
            <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
              <h3 className="font-extrabold flex items-center gap-2"><Mail className="w-4 h-4" /> Inviter un employé</h3>
              <input className={input} type="email" placeholder="E-mail" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <select className={input} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as TenantRole)}>
                {(current.role === 'OWNER' ? (['ADMIN', 'MANAGER', 'CASHIER'] as TenantRole[]) : (['MANAGER', 'CASHIER'] as TenantRole[]))
                  .map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <select className={input} value={inviteBranch} onChange={(e) => setInviteBranch(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className={btn} disabled={busy || !inviteEmail.includes('@')} onClick={doInvite}>Inviter</button>
              {lastCode && <p className="p-2 rounded-xl bg-amber-50 border border-amber-200 break-all select-all">Code : <b>{lastCode}</b></p>}
            </div>
          )}
        {current && canManage && (
          <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-2">
            <h3 className="font-extrabold flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> Inviter un gestionnaire sans e-mail
            </h3>
            <p className="text-slate-600">
              Code valable 7 jours et utilisable une seule fois.
            </p>
            <select
              className={input}
              value={inviteBranch}
              onChange={(e) => setInviteBranch(e.target.value)}
            >
              <option value="">Choisir un établissement</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button
              className={btn}
              disabled={busy || !inviteBranch}
              onClick={doInviteAnonymousManager}
            >
              <KeyRound className="w-3.5 h-3.5" /> Générer le code
            </button>
            {lastAnonymousCode && (
              <div className="p-3 rounded-xl bg-white border border-emerald-200 break-all select-all">
                <p className="font-bold mb-1">Code à transmettre à Didier :</p>
                <b>{lastAnonymousCode}</b>
                <p className="text-[10px] text-slate-500 mt-2">
                  Conservez ce code : il ne sera plus affiché après actualisation.
                </p>
              </div>
            )}
          </div>
        )}
        </>
      )}
    </div>
  );
};
