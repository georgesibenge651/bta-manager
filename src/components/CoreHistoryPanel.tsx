import React,{useEffect,useState} from 'react';
import {cachedHistory,refreshHistory,CoreHistory,HistoryContext} from '../core/history';
import {History as HistoryIcon, RefreshCw, CheckCircle2, AlertCircle} from 'lucide-react';

const labels={sales:'Ventes',debts:'Dettes et créances',payments:'Paiements clients',refunds:'Remboursements de ventes'};

export function CoreHistoryPanel({context,permissions}:{context:HistoryContext;permissions:string[]}){
 const [history,setHistory]=useState<CoreHistory|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;setBusy(true);void (async()=>{
   const cached=await cachedHistory(context,permissions);if(live)setHistory(cached);
   try{const received=await refreshHistory(context,permissions);if(live){setHistory(received);setMessage('Historiques reçus de Core.');}}
   catch(e){if(live)setMessage(`${String(e)} Les données en cache peuvent être anciennes.`);}
   finally{if(live)setBusy(false);}
 })().catch(e=>{if(live){setBusy(false);setMessage(String(e));}});return()=>{live=false;};},[context.tenantId,context.branchId,context.userId,permissions.join('|')]);
 return <div className="space-y-3 min-w-0">
   <p className="text-xs text-slate-600">Consultez les informations confirmées par le serveur. Les opérations locales en attente restent protégées.</p>
   <button disabled={busy} type="button" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
     onClick={()=>{setBusy(true);void refreshHistory(context,permissions).then(r=>{setHistory(r);setMessage('Historiques reçus de Core.');}).catch(e=>setMessage(String(e))).finally(()=>setBusy(false));}}>
     <RefreshCw size={14} className={busy?'animate-spin':''}/>{busy?'Actualisation…':'Actualiser les historiques'}
   </button>
   <p role="status" className="flex items-start gap-2 text-[11px] text-slate-500 break-words">
     {history?<CheckCircle2 size={14} className="text-emerald-600 shrink-0"/>:<HistoryIcon size={14} className="shrink-0"/>}
     <span>{busy?'Chargement des historiques…':message}{history?` · Reçu le ${new Date(history.receivedAt).toLocaleString()}`:''}</span>
   </p>
   {history&&Object.entries(history.records).map(([resource,rows])=><details key={resource} className="rounded-xl border border-slate-200 overflow-hidden min-w-0">
     <summary className="cursor-pointer list-none flex items-center justify-between gap-2 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
       <span>{labels[resource as keyof typeof labels]??resource}</span><span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">{rows.length}</span>
     </summary>
     <div className="max-h-64 overflow-y-auto overflow-x-hidden divide-y divide-slate-100">
       {[...rows].reverse().map(row=><article className="p-3 text-xs space-y-1 min-w-0" key={String(row.id)}>
         <div className="flex flex-wrap items-center gap-1 text-slate-800 font-semibold"><span>#{String(row.id)}</span><span>· {String(row.reference??row.sale_id??row.entity_id??'Sans référence')}</span></div>
         <p className="text-slate-600 break-words">{String(row.status??row.method??'')} · {String(row.total??row.balance??row.amount??'')} {String(row.currency??'')} · {String(row.created_at??'')}</p>
         <p className="text-slate-500 break-words">Payé : {String(row.paid??row.paid_amount??'—')} · Solde : {String(row.balance??'—')} · Auteur : #{String(row.created_by??'—')}</p>
       </article>)}
     </div>
   </details>)}
   {!history&&message&&!busy&&<p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 flex gap-2"><AlertCircle size={15} className="shrink-0"/>{message}</p>}
 </div>;
}
