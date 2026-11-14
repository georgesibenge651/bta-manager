import React,{useEffect,useState} from 'react';
import {cachedHistory,refreshHistory,CoreHistory,HistoryContext} from '../core/history';
const labels={sales:'Ventes',debts:'Dettes et créances',payments:'Paiements clients',refunds:'Remboursements de ventes'};
export function CoreHistoryPanel({context,permissions}:{context:HistoryContext;permissions:string[]}){
 const [history,setHistory]=useState<CoreHistory|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;setBusy(true);void (async()=>{
   const cached=await cachedHistory(context,permissions);if(live)setHistory(cached);
   try{const received=await refreshHistory(context,permissions);if(live){setHistory(received);setMessage('Historiques reçus de Core.');}}
   catch(e){if(live)setMessage(`${String(e)} Les données en cache peuvent être anciennes.`);}
   finally{if(live)setBusy(false);}
 })().catch(e=>{if(live){setBusy(false);setMessage(String(e));}});return()=>{live=false;};},[context.tenantId,context.branchId,context.userId,permissions.join('|')]);
 return <section className="border rounded-xl p-3 space-y-2"><h3 className="font-bold">Historiques Core · établissement actif</h3>
   <p className="text-xs">Lecture des données serveur. Les opérations locales en attente restent dans leur file et ne sont pas remplacées.</p>
   <button disabled={busy} type="button" onClick={()=>{setBusy(true);void refreshHistory(context,permissions).then(r=>{setHistory(r);setMessage('Historiques reçus de Core.');}).catch(e=>setMessage(String(e))).finally(()=>setBusy(false));}}>Actualiser les historiques</button>
   <p role="status" className="text-xs">{busy?'Chargement…':message}{history?` · dernière réception ${new Date(history.receivedAt).toLocaleString()}`:''}</p>
   {history&&Object.entries(history.records).map(([resource,rows])=><details key={resource}><summary>{labels[resource as keyof typeof labels]} ({rows.length})</summary><div className="max-h-64 overflow-y-auto space-y-1">{[...rows].reverse().map(row=><article className="border-t p-2 text-xs" key={String(row.id)}>#{String(row.id)} · {String(row.reference??row.sale_id??row.entity_id??'')} · {String(row.status??row.method??'')} · {String(row.total??row.balance??row.amount??'')} {String(row.currency??'')} · auteur #{String(row.created_by??'non fourni')} · {String(row.created_at??'')}<p>Payé : {String(row.paid??row.paid_amount??'—')} · solde : {String(row.balance??'—')} · référence : {String(row.reference??'—')}</p></article>)}</div></details>)}
 </section>;
}
