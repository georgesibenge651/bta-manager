import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, X } from 'lucide-react';

export interface SyncQueueEntry {
  id: string; type: string; timestamp: string;
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'REVIEW';
  error?: string;
}

interface CoreSyncCenterProps {
  isOpen: boolean;
  pending: SyncQueueEntry[];
  history: Array<{ id: string; type: string; status: 'DONE'|'FAILED'|'REVIEW'; timestamp: string; error?: string }>;
  onClose: () => void;
  onRetry: (id: string, confirmedNotApplied: boolean) => void;
}

const label: Record<SyncQueueEntry['status'], string> = {
  PENDING: 'En attente', PROCESSING: 'En cours', FAILED: 'Échec', REVIEW: 'À vérifier',
};

export const CoreSyncCenter: React.FC<CoreSyncCenterProps> = ({ isOpen, pending, history, onClose, onRetry }) => {
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/60 p-3 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="core-sync-title">
      <section className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col">
        <header className="px-4 py-3 bg-[#0F2444] text-white flex items-center justify-between">
          <div><h2 id="core-sync-title" className="font-bold">Synchronisation Core</h2><p className="text-xs text-slate-300">{pending.length} opération(s) à traiter</p></div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="Fermer"><X size={18}/></button>
        </header>
        <div className="overflow-y-auto p-4 space-y-5">
          {pending.length === 0 && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl p-3">Aucune opération en attente.</p>}
          {pending.map((op) => (
            <article key={op.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0"><div className="font-semibold text-sm">{op.type}</div><div className="text-[11px] text-slate-500 break-all">UUID {op.id}</div></div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${op.status === 'REVIEW' ? 'bg-amber-100 text-amber-900' : op.status === 'FAILED' ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-900'}`}>{label[op.status]}</span>
              </div>
              {op.error && <p className="text-xs text-rose-700">{op.error}</p>}
              {op.status === 'REVIEW' && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-950 space-y-2">
                <p className="flex gap-2"><AlertTriangle size={16} className="shrink-0"/>Le résultat serveur est incertain. Cette commande ne sera jamais relancée automatiquement.</p>
                <label className="flex gap-2 items-start"><input type="checkbox" checked={!!verified[op.id]} onChange={e => setVerified(v => ({ ...v, [op.id]: e.target.checked }))}/><span>J’ai vérifié dans Core que cette opération n’a pas été appliquée. Créer une nouvelle commande avec un nouvel UUID.</span></label>
                <button disabled={!verified[op.id]} onClick={() => { onRetry(op.id, true); setVerified(v => ({ ...v, [op.id]: false })); }} className="inline-flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-white disabled:opacity-40"><RefreshCw size={14}/>Recréer après vérification</button>
              </div>}
              {op.status === 'FAILED' && <button onClick={() => onRetry(op.id, false)} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white"><RefreshCw size={14}/>Recréer l’opération</button>}
              {(op.status === 'PENDING' || op.status === 'PROCESSING') && <p className="text-xs text-slate-600">La reprise conserve le même UUID; Core sera interrogé avant tout nouvel envoi.</p>}
            </article>
          ))}
          {history.length > 0 && <section><h3 className="font-semibold text-sm mb-2">Historique récent</h3><div className="space-y-2">{history.slice(0, 50).map(entry => <div key={`${entry.id}-${entry.timestamp}`} className="flex gap-2 items-start border-b border-slate-100 pb-2 text-xs"><span className="mt-0.5">{entry.status === 'DONE' ? <CheckCircle2 size={14} className="text-emerald-600"/> : entry.status === 'REVIEW' ? <AlertTriangle size={14} className="text-amber-600"/> : <Clock3 size={14} className="text-rose-600"/>}</span><div className="min-w-0"><b>{entry.type}</b> · {entry.status} · {new Date(entry.timestamp).toLocaleString()}<div className="text-slate-500 break-all">{entry.id}{entry.error ? ` · ${entry.error}` : ''}</div></div></div>)}</div></section>}
        </div>
      </section>
    </div>
  );
};
