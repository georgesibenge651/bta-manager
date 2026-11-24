import {displayCompanyName} from '../core/branding';
import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Mail, KeyRound, Store } from 'lucide-react';
import { getFirebaseUser } from '../firebase/auth';
import { migrateLocalData, isMigrated } from '../db/migration';
import { appRepository } from '../db/storage';
import {
  Membership, Branch, TenantRole, listMemberships, listBranches, createTenant, createBranch,
  inviteMember, inviteAnonymousManager, acceptInvitation, getActiveContext, setActiveContext, newRequestId, assertBranchAccess,
} from '../firebase/tenancy';
import { useLanguage } from '../i18n';

/** Onglet « Entreprise » : création, établissements, invitations. Exige une connexion Firebase. */
export const CompanyPanel: React.FC = () => {
  const { language, t } = useLanguage();
  const ROLE_LABEL: Record<TenantRole, string> = {
    OWNER: t('Propriétaire', 'Owner'), ADMIN: t('Administrateur', 'Administrator'),
    MANAGER: t('Gestionnaire', 'Manager'), CASHIER: t('Caissier', 'Cashier'),
  };
  const [uid, setUid] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [joinBranchId, setJoinBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [branchName, setBranchName] = useState(() => t('Établissement principal', 'Main branch'));
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
        if (!account) { setErr(t('Connectez d’abord votre compte Firebase (écran de verrouillage).', 'First connect your Firebase account (lock screen).')); return; }
        setUid(account.uid);
        await refresh(account.uid);
      } catch (e) { setErr(e instanceof Error ? e.message : t('Firebase indisponible.', 'Firebase is unavailable.')); }
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
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : t('Erreur.', 'An error occurred.')); } finally { setBusy(false); }
  };

  const doCreateTenant = () => run(async () => {
    const r = await createTenant(companyName, branchName, requestId);
    setRequestId(newRequestId());
    await setActiveContext({ tenantId: r.tenantId, branchId: r.branchId });
    setCompanyName('');
    setMsg(t('Entreprise créée.', 'Company created.'));
    if (uid) await refresh(uid);
  });

  const doAccept = () => run(async () => {
    const r = await acceptInvitation(code);
    await setActiveContext({ tenantId: r.tenantId, branchId: null });
    setCode(''); setMsg(t('Invitation acceptée.', 'Invitation accepted.'));
    if (uid) await refresh(uid);
  });

  const doCreateBranch = () => run(async () => {
    if (!tenantId) return;
    await createBranch(tenantId, newBranch);
    setNewBranch(''); setBranches(await listBranches(tenantId)); setMsg(t('Établissement créé.', 'Branch created.'));
  });

  const doMigrate = () => run(async () => {
    if (!tenantId || branches.length !== 1) throw new Error(t('Un seul établissement est attendu pour cette migration.', 'Exactly one branch is required for this migration.'));
    const r = await migrateLocalData(tenantId, branches[0].id, (p) => setProgress(`${p.collection} : ${p.done}/${p.total}`));
    appRepository.enableCloudSync(tenantId, branches[0].id);
    setMigrated(true); setProgress('');
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    setMsg(t(`Migration terminée et vérifiée : ${total} enregistrements. Vos données locales sont conservées.`, `Migration complete and verified: ${total} records. Your local data has been preserved.`));
  });

  const doJoin = () => run(async () => {
    if (!tenantId || !joinBranchId || !branches.some((b) => b.id === joinBranchId)) throw new Error(t('Choisissez un établissement auquel votre compte a accès.', 'Choose a branch your account can access.'));
    await assertBranchAccess(tenantId, joinBranchId);
    if (!window.confirm(t('Les données commerciales actuellement sur ce téléphone (y compris les données de démonstration) seront remplacées par celles de l’entreprise. Continuer ?', 'The business data currently on this phone (including demo data) will be replaced with the company data. Continue?'))) return;
    appRepository.joinCloudAsNewDevice(tenantId, joinBranchId);
    await setActiveContext({ tenantId, branchId: joinBranchId });
    setMsg(t('Appareil connecté. Téléchargement des données en cours…', 'Device connected. Downloading data…'));
  });

  const switchBranch = (branchId: string) => run(async () => {
    if (!tenantId || !branches.some((b) => b.id === branchId)) throw new Error(t('Établissement non autorisé.', 'Branch not authorized.'));
    await assertBranchAccess(tenantId, branchId);
    if (!window.confirm(t('Les données déjà synchronisées de cet appareil seront remplacées par les données de l’établissement choisi. Continuer ?', 'The data already synced to this device will be replaced with data from the selected branch. Continue?'))) return;
    appRepository.switchCloudContext(tenantId, branchId);
    await setActiveContext({ tenantId, branchId });
    setMsg(t('Changement d’établissement lancé. Téléchargement des données en cours…', 'Branch switch started. Downloading data…'));
  });

  const doInvite = () => run(async () => {
    if (!tenantId || !inviteBranch) throw new Error(t('Choisissez un établissement.', 'Choose a branch.'));
    const r = await inviteMember(tenantId, inviteEmail, inviteRole, [{ branchId: inviteBranch, role: inviteRole }]);
    setLastCode(r.code); setInviteEmail(''); setMsg(t('Invitation créée. Transmettez le code ci-dessous.', 'Invitation created. Share the code below.'));
  });

  const doInviteAnonymousManager = () => run(async () => {
    if (!tenantId || !inviteBranch) throw new Error(t('Choisissez un établissement.', 'Choose a branch.'));
    const result = await inviteAnonymousManager(tenantId, [{ branchId: inviteBranch }]);
    setLastAnonymousCode(result.code);
    setMsg(t('Invitation gestionnaire créée. Transmettez ce code à Didier.', 'Manager invitation created. Share this code with Didier.'));
  });

  const input = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-xs';
  const btn = 'px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1';

  return (
    <div className="space-y-4 text-xs">
      {err && <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-800 font-bold">{err}</div>}
      {msg && <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">{msg}</div>}

      {uid && (
        <>
          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <h3 className="font-extrabold flex items-center gap-2"><Building2 className="w-4 h-4" /> {t('Mes entreprises', 'My companies')}</h3>
            {memberships.length === 0 && <p className="text-slate-500">{t('Aucune entreprise. Créez-en une ou acceptez une invitation.', 'No companies yet. Create one or accept an invitation.')}</p>}
            {memberships.map((m) => (
              <button key={m.tenantId} type="button" disabled={busy}
                onClick={() => { setTenantId(m.tenantId); void setActiveContext({ tenantId: m.tenantId, branchId: null }); }}
                className={`w-full text-left p-3 rounded-xl border ${m.tenantId === tenantId ? 'border-amber-500 bg-amber-50' : 'border-slate-200'}`}>
                <b>{displayCompanyName(m.name)}</b> · {ROLE_LABEL[m.role] ?? m.role}
              </button>
            ))}
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <h3 className="font-extrabold flex items-center gap-2"><Plus className="w-4 h-4" /> {t('Créer une entreprise', 'Create a company')}</h3>
            <input className={input} placeholder={t('Nom de l’entreprise', 'Company name')} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            <input className={input} placeholder={t('Premier établissement', 'First branch')} value={branchName} onChange={(e) => setBranchName(e.target.value)} />
            <button className={btn} disabled={busy || companyName.trim().length < 2} onClick={doCreateTenant}>{t('Créer', 'Create')}</button>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <h3 className="font-extrabold flex items-center gap-2"><KeyRound className="w-4 h-4" /> {t('J’ai un code d’invitation', 'I have an invitation code')}</h3>
            <input className={input} placeholder={t('Code reçu', 'Invitation code')} value={code} onChange={(e) => setCode(e.target.value)} />
            <p className="text-slate-500">{t('Votre e-mail Firebase doit être vérifié et identique à celui invité.', 'Your Firebase email must be verified and match the invited email address.')}</p>
            <button className={btn} disabled={busy || !code.includes('.')} onClick={doAccept}>{t('Rejoindre', 'Join')}</button>
          </div>

          {current && (
            <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
              <h3 className="font-extrabold flex items-center gap-2"><Store className="w-4 h-4" /> {t('Établissements de', 'Branches for')} {displayCompanyName(current.name)}</h3>
              {branches.map((b) => <div key={b.id} className="p-2 rounded-xl bg-slate-50 flex items-center justify-between gap-2">
                <span>{displayCompanyName(b.name)}</span>
                {appRepository.isCloudEnabled() && <button className="text-amber-700 font-bold disabled:text-slate-400"
                  disabled={busy || appRepository.getCloudContext()?.tenantId === tenantId && appRepository.getCloudContext()?.branchId === b.id}
                  onClick={() => switchBranch(b.id)}>{t('Utiliser ici', 'Use here')}</button>}
              </div>)}
              {current.role === 'OWNER' && (
                <div className="flex gap-2">
                  <input className={input} placeholder={t('Nouvel établissement', 'New branch')} value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
                  <button className={btn} disabled={busy || newBranch.trim().length < 2} onClick={doCreateBranch}>{t('Ajouter', 'Add')}</button>
                </div>
              )}
            </div>
          )}

          {current && current.role === 'OWNER' && branches.length === 1 && (
            <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 space-y-2">
              <h3 className="font-extrabold">{t('Envoyer les données de cet appareil', 'Upload this device’s data')}</h3>
              <p className="text-slate-600">
                {t('Produits, clients, ventes, dettes, stock… seront copiés vers', 'Products, customers, sales, debts, and inventory will be copied to')} « {displayCompanyName(branches[0].name)} ».
                {t(' Rien n’est supprimé sur ce téléphone. Gardez une connexion stable ; en cas de coupure, relancez : l’envoi reprend sans doublon.', ' Nothing is deleted from this phone. Keep a stable connection; if interrupted, restart the upload to resume without duplicates.')}
              </p>
              {migrated ? <p className="font-bold text-emerald-700">✔ {t('Déjà migré.', 'Already migrated.')}</p> :
                <button className={btn} disabled={busy} onClick={doMigrate}>{busy ? t('Envoi en cours…', 'Uploading…') : t('Lancer la migration', 'Start migration')}</button>}
              {progress && <p className="font-mono">{progress}</p>}
            </div>
          )}

          {current && !migrated && !appRepository.isCloudEnabled() && (
            <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
              <h3 className="font-extrabold">{t('Nouvel appareil de cette entreprise', 'New device for this company')}</h3>
              <p className="text-slate-600">{t('Si les données de l’entreprise sont déjà en ligne, téléchargez-les sur ce téléphone.', 'If the company data is already online, download it to this phone.')}</p>
              <select className={input} value={joinBranchId} onChange={(e) => setJoinBranchId(e.target.value)}>
                <option value="">{t('Choisissez un établissement accessible', 'Choose an accessible branch')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{displayCompanyName(b.name)}</option>)}
              </select>
              <button className={btn} disabled={busy || !joinBranchId} onClick={doJoin}>{t('Télécharger les données', 'Download data')}</button>
            </div>
          )}

          {appRepository.isCloudEnabled() && (
            <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-1">
              <h3 className="font-extrabold">{t('Synchronisation active', 'Sync is active')}</h3>
              <p className="text-slate-600">{t('Les ventes, stocks et dettes sont envoyés automatiquement et fonctionnent hors connexion.', 'Sales, inventory, and debts sync automatically and work offline.')}</p>
              {appRepository.getSyncRejections().slice(0, 5).map((r) => (
                <div key={r.id} className="text-red-700 font-bold flex items-start justify-between gap-2">
                  <p>⚠ {new Date(r.at).toLocaleString(language === 'fr' ? 'fr-FR' : 'en-US')} — {r.reason}</p>
                  <button className="underline shrink-0" onClick={() => {
                    if (window.confirm(t('Réessayer cette opération avec un nouvel identifiant ? Vérifiez d’abord que les données ou les permissions ont été corrigées.', 'Retry this operation with a new ID? First make sure the data or permissions have been corrected.'))) {
                      try { appRepository.retryRejectedOperation(r.id); } catch (e) { setErr(e instanceof Error ? e.message : t('Réessai impossible.', 'Unable to retry.')); }
                    }
                  }}>{t('Réessayer', 'Retry')}</button>
                </div>
              ))}
            </div>
          )}

          {current && canManage && (
            <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
              <h3 className="font-extrabold flex items-center gap-2"><Mail className="w-4 h-4" /> {t('Inviter un employé', 'Invite an employee')}</h3>
              <input className={input} type="email" placeholder={t('E-mail', 'Email')} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <select className={input} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as TenantRole)}>
                {(current.role === 'OWNER' ? (['ADMIN', 'MANAGER', 'CASHIER'] as TenantRole[]) : (['MANAGER', 'CASHIER'] as TenantRole[]))
                  .map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <select className={input} value={inviteBranch} onChange={(e) => setInviteBranch(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{displayCompanyName(b.name)}</option>)}
              </select>
              <button className={btn} disabled={busy || !inviteEmail.includes('@')} onClick={doInvite}>{t('Inviter', 'Invite')}</button>
              {lastCode && <p className="p-2 rounded-xl bg-amber-50 border border-amber-200 break-all select-all">Code : <b>{lastCode}</b></p>}
            </div>
          )}
        {current && canManage && (
          <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-2">
            <h3 className="font-extrabold flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> {t('Inviter un gestionnaire sans e-mail', 'Invite a manager without email')}
            </h3>
            <p className="text-slate-600">
              {t('Code valable 7 jours et utilisable une seule fois.', 'Code is valid for 7 days and can only be used once.')}
            </p>
            <select
              className={input}
              value={inviteBranch}
              onChange={(e) => setInviteBranch(e.target.value)}
            >
              <option value="">{t('Choisir un établissement', 'Choose a branch')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{displayCompanyName(b.name)}</option>)}
            </select>
            <button
              className={btn}
              disabled={busy || !inviteBranch}
              onClick={doInviteAnonymousManager}
            >
              <KeyRound className="w-3.5 h-3.5" /> {t('Générer le code', 'Generate code')}
            </button>
            {lastAnonymousCode && (
              <div className="p-3 rounded-xl bg-white border border-emerald-200 break-all select-all">
                <p className="font-bold mb-1">{t('Code à transmettre à Didier :', 'Code to share with Didier:')}</p>
                <b>{lastAnonymousCode}</b>
                <p className="text-[10px] text-slate-500 mt-2">
                  {t('Conservez ce code : il ne sera plus affiché après actualisation.', 'Save this code; it will no longer be shown after refreshing.')}
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
