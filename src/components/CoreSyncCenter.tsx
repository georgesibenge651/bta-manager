import React, { useMemo, useState } from 'react';
import { CoreCashPanel } from './CoreCashPanel';
import { CoreHistoryPanel } from './CoreHistoryPanel';
import {
  AlertTriangle, CheckCircle2, Clock3, RefreshCw, X, Minus, Plus,
  Activity, Wallet, History, ListChecks, LayoutDashboard, ChevronRight
} from 'lucide-react';
import { useLanguage } from '../i18n';

export interface SyncQueueEntry {
  id: string; type: string; timestamp: string;
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'REVIEW';
  error?: string;
}

interface CoreSyncCenterProps {
  historyContext?: {tenantId:number;branchId:number;userId:number};
  permissions?: string[];
  cashContext?: {tenantId:number; branchId:number; userId:number};
  isOpen: boolean;
  pending: SyncQueueEntry[];
  history: Array<{ id: string; type: string; status: 'DONE'|'FAILED'|'REVIEW'; timestamp: string; error?: string }>;
  onClose: () => void;
  onRetry: (id: string, confirmedNotApplied: boolean) => void;
}

type Tab = 'overview' | 'history' | 'cash' | 'operations';

export const CoreSyncCenter: React.FC<CoreSyncCenterProps> = ({
  isOpen, pending, history, onClose, onRetry, cashContext, historyContext, permissions=[]
}) => {
  const { language, t } = useLanguage();
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>('overview');
  const [textScale, setTextScale] = useState(1);

  const counts = useMemo(() => ({
    pending: pending.filter(x => x.status === 'PENDING').length,
    processing: pending.filter(x => x.status === 'PROCESSING').length,
    failed: pending.filter(x => x.status === 'FAILED').length,
    review: pending.filter(x => x.status === 'REVIEW').length,
  }), [pending]);

  if (!isOpen) return null;

  const statusLabel: Record<SyncQueueEntry['status'], string> = {
    PENDING: t('En attente','Pending'), PROCESSING: t('En cours','In progress'), FAILED: t('Échec','Failed'), REVIEW: t('À vérifier','Needs review'),
  };
  const tabs: Array<{id:Tab;label:string;short:string;icon:React.ReactNode;count?:number}> = [
    {id:'overview',label:t('Vue générale','Overview'),short:t('Vue','Overview'),icon:<LayoutDashboard size={17}/>},
    {id:'history',label:t('Historiques','History'),short:t('Historiques','History'),icon:<History size={17}/>},
    ...(cashContext ? [{id:'cash' as const,label:t('Caisses','Cash registers'),short:t('Caisses','Cash'),icon:<Wallet size={17}/>} ] : []),
    {id:'operations',label:t('Opérations','Operations'),short:t('Opérations','Operations'),icon:<ListChecks size={17}/>,count:pending.length},
  ];

  const stat = (title:string,value:number,tone:string,icon:React.ReactNode) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 min-w-0 shadow-sm">
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>{icon}</div>
      <div className="text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{title}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/70 flex items-stretch justify-center" role="dialog" aria-modal="true" aria-labelledby="core-sync-title">
      <section className="bg-slate-50 w-full max-w-5xl h-[100dvh] sm:h-[94dvh] sm:my-auto sm:rounded-3xl sm:overflow-hidden shadow-2xl flex flex-col min-w-0">
        <header className="px-4 py-3 sm:px-6 sm:py-4 bg-[#0F2444] text-white shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0"><Activity size={21}/></span>
                <div className="min-w-0">
                  <h2 id="core-sync-title" className="font-bold text-base sm:text-xl leading-tight">{t('Centre de synchronisation','Sync center')}</h2>
                  <p className="text-xs sm:text-sm text-slate-300 mt-0.5">{t('Suivi des données, historiques et caisses','Monitor data, history, and cash registers')}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${pending.length ? 'bg-amber-400/15 text-amber-100' : 'bg-emerald-400/15 text-emerald-100'}`}>
                  <span className={`w-2 h-2 rounded-full ${pending.length ? 'bg-amber-400' : 'bg-emerald-400'}`}/>
                  {pending.length ? `${pending.length} ${t('opération(s) à traiter','operation(s) to process')}` : t('Synchronisation à jour','Sync is up to date')}
                </span>
                <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-200">Core · {t('Établissement actif','Active branch')}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => setTextScale(v => Math.max(.9, Number((v-.05).toFixed(2))))} className="rounded-lg p-2 hover:bg-white/10" aria-label={t('Réduire le texte','Decrease text size')}><Minus size={17}/></button>
              <button type="button" onClick={() => setTextScale(v => Math.min(1.2, Number((v+.05).toFixed(2))))} className="rounded-lg p-2 hover:bg-white/10" aria-label={t('Agrandir le texte','Increase text size')}><Plus size={17}/></button>
              <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10" aria-label={t('Fermer','Close')}><X size={20}/></button>
            </div>
          </div>
        </header>

        <nav aria-label={t('Navigation du centre de synchronisation','Sync center navigation')} className="shrink-0 bg-white border-b border-slate-200 px-2 sm:px-5">
          <div className="flex gap-1 overflow-x-auto py-2">
            {tabs.map(item => (
              <button key={item.id} type="button" onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
                className={`shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold transition ${tab === item.id ? 'bg-[#0F2444] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
                {item.icon}<span>{item.label}</span>
                {item.count !== undefined && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab===item.id?'bg-white/20':'bg-slate-200 text-slate-700'}`}>{item.count}</span>}
              </button>
            ))}
          </div>
        </nav>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5 min-w-0" style={{fontSize:`${textScale}rem`}}>
          <div hidden={tab !== 'overview'} className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="font-bold text-slate-900 text-base sm:text-lg">{t('Vue générale','Overview')}</h3><p className="text-xs sm:text-sm text-slate-500">{t('Résumé de l’activité de synchronisation','Sync activity summary')}</p></div>
              <span className="text-[11px] text-slate-500">{t('État actuel','Current status')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {stat(t('En attente','Pending'),counts.pending,'bg-amber-50 text-amber-700',<Clock3 size={18}/>)}
              {stat(t('En cours','In progress'),counts.processing,'bg-amber-50 text-amber-700',<RefreshCw size={18}/>)}
              {stat(t('Échecs','Failures'),counts.failed,'bg-rose-50 text-rose-700',<AlertTriangle size={18}/>)}
              {stat(t('À vérifier','Needs review'),counts.review,'bg-amber-50 text-amber-700',<AlertTriangle size={18}/>)}
            </div>
            <div className={`rounded-2xl border p-4 ${pending.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className="flex items-start gap-3">
                {pending.length ? <Clock3 className="text-amber-700 shrink-0" size={21}/> : <CheckCircle2 className="text-emerald-700 shrink-0" size={21}/>}
                <div className="min-w-0">
                  <p className={`font-bold text-sm ${pending.length ? 'text-amber-950' : 'text-emerald-950'}`}>{pending.length ? t('Des opérations nécessitent votre attention','Some operations need your attention') : t('Toutes les opérations sont synchronisées','All operations are synced')}</p>
                  <p className={`text-xs mt-1 ${pending.length ? 'text-amber-900' : 'text-emerald-900'}`}>{pending.length ? t('Consultez l’onglet Opérations pour examiner les éléments en attente ou en erreur.','Open the Operations tab to review pending or failed items.') : t('Aucune opération locale n’attend actuellement un traitement.','No local operations are currently awaiting processing.')}</p>
                  {pending.length > 0 && <button type="button" onClick={()=>setTab('operations')} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-amber-950 underline">{t('Voir les opérations','View operations')} <ChevronRight size={14}/></button>}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button type="button" onClick={()=>setTab('history')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-amber-300">
                <span className="flex items-center gap-2 font-bold text-sm text-slate-900"><History size={18} className="text-amber-700"/>{t('Historiques reçus de Core','History received from Core')}</span>
                <span className="mt-1 block text-xs text-slate-500">{t('Consulter ventes, dettes, paiements et remboursements.','View sales, debts, payments, and refunds.')}</span>
              </button>
              {cashContext && <button type="button" onClick={()=>setTab('cash')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-emerald-300">
                <span className="flex items-center gap-2 font-bold text-sm text-slate-900"><Wallet size={18} className="text-emerald-700"/>{t('Gestion des caisses','Cash register management')}</span>
                <span className="mt-1 block text-xs text-slate-500">{t('Vérifier les caisses ouvertes et clôturer une session.','Review open cash registers and close a session.')}</span>
              </button>}
            </div>
            {history.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="font-bold text-sm text-slate-900 mb-3">{t('Dernières opérations traitées','Latest processed operations')}</h4>
              <div className="space-y-2">{history.slice(0,4).map(entry=><div key={`${entry.id}-${entry.timestamp}`} className="flex items-start gap-2 border-b border-slate-100 pb-2 last:border-0">
                {entry.status==='DONE'?<CheckCircle2 size={15} className="text-emerald-600 mt-0.5"/>:entry.status==='REVIEW'?<AlertTriangle size={15} className="text-amber-600 mt-0.5"/>:<Clock3 size={15} className="text-rose-600 mt-0.5"/>}
                <div className="min-w-0 flex-1 text-xs"><p className="font-semibold text-slate-800">{entry.type} · {entry.status === 'DONE' ? t('Terminée','Done') : entry.status === 'REVIEW' ? t('À vérifier','Needs review') : t('Échec','Failed')}</p><p className="text-slate-500 break-all">{entry.id}</p></div>
                <span className="text-[10px] text-slate-400 shrink-0">{new Date(entry.timestamp).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US')}</span>
              </div>)}</div>
            </section>}
          </div>

          <div hidden={tab !== 'history'} className="space-y-3">
            <div><h3 className="font-bold text-base sm:text-lg text-slate-900">{t('Historiques','History')}</h3><p className="text-xs sm:text-sm text-slate-500">{t('Données reçues et confirmées par Core.','Data received and confirmed by Core.')}</p></div>
            {historyContext ? <CoreHistoryPanel key={`${historyContext.tenantId}-${historyContext.branchId}-${historyContext.userId}`} context={historyContext} permissions={permissions}/> : <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600">{t('Contexte d’établissement indisponible.','Branch context unavailable.')}</p>}
          </div>

          {cashContext && <div hidden={tab !== 'cash'} className="space-y-3">
            <div><h3 className="font-bold text-base sm:text-lg text-slate-900">{t('Gestion des caisses','Cash register management')}</h3><p className="text-xs sm:text-sm text-slate-500">{t('Ouverture, état et clôture des sessions de caisse.','Open, review, and close cash register sessions.')}</p></div>
            <CoreCashPanel key={`${cashContext.tenantId}-${cashContext.branchId}`} {...cashContext}/>
          </div>}

          <div hidden={tab !== 'operations'} className="space-y-3">
            <div><h3 className="font-bold text-base sm:text-lg text-slate-900">{t('Opérations de synchronisation','Sync operations')}</h3><p className="text-xs sm:text-sm text-slate-500">{t('Suivi détaillé des opérations locales.','Detailed view of local operations.')}</p></div>
            {pending.length === 0 && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex gap-3 text-sm text-emerald-900"><CheckCircle2 size={20} className="shrink-0"/><span><strong>{t('Tout est à jour.','Everything is up to date.')}</strong><br/>{t('Aucune opération locale en attente.','No local operations pending.')}</span></div>}
            {pending.map(op=>(
              <article key={op.id} className="border border-slate-200 bg-white rounded-2xl p-3 sm:p-4 space-y-3 shadow-sm min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1"><div className="font-bold text-sm text-slate-900 break-words">{op.type}</div><div className="text-[11px] text-slate-500 break-all mt-1">UUID {op.id}</div></div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${op.status === 'REVIEW' ? 'bg-amber-100 text-amber-900' : op.status === 'FAILED' ? 'bg-rose-100 text-rose-800' : op.status === 'PROCESSING' ? 'bg-amber-100 text-amber-800' : 'bg-amber-100 text-amber-900'}`}>{statusLabel[op.status]}</span>
                </div>
                {op.error && <p className="text-xs text-rose-700 break-words rounded-lg bg-rose-50 p-2">{op.error}</p>}
                {op.status === 'REVIEW' && <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950 space-y-3">
                  <p className="flex gap-2"><AlertTriangle size={16} className="shrink-0"/>{t('Le résultat serveur est incertain. Cette commande ne sera jamais relancée automatiquement.','The server result is uncertain. This request will never be retried automatically.')}</p>
                  <label className="flex gap-2 items-start"><input type="checkbox" checked={!!verified[op.id]} onChange={e => setVerified(v => ({ ...v, [op.id]: e.target.checked }))}/><span>{t('J’ai vérifié dans Core que cette opération n’a pas été appliquée. Créer une nouvelle commande avec un nouvel UUID.','I confirmed in Core that this operation was not applied. Create a new request with a new UUID.')}</span></label>
                  <button disabled={!verified[op.id]} onClick={() => { onRetry(op.id, true); setVerified(v => ({ ...v, [op.id]: false })); }} className="inline-flex items-center gap-2 rounded-xl bg-amber-800 px-3 py-2.5 font-semibold text-white disabled:opacity-40"><RefreshCw size={14}/>{t('Recréer après vérification','Recreate after verification')}</button>
                </div>}
                {op.status === 'FAILED' && <button onClick={() => onRetry(op.id, false)} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-xs font-semibold text-white"><RefreshCw size={14}/>{t('Recréer l’opération','Recreate operation')}</button>}
                {(op.status === 'PENDING' || op.status === 'PROCESSING') && <p className="text-xs text-slate-600">{t('La reprise conserve le même UUID ; Core sera interrogé avant tout nouvel envoi.','Retrying keeps the same UUID; Core will be queried before sending again.')}</p>}
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
