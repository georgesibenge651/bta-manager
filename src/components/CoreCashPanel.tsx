import React, {useEffect, useState} from 'react';
import {coreCashSessions, coreOpenCash, coreCloseCash} from '../core/api';

export function CoreCashPanel({tenantId,branchId,userId}:{tenantId:number;branchId:number;userId:number}) {
  const [sessions,setSessions]=useState<Array<Record<string,unknown>>>([]);
  const [currency,setCurrency]=useState<'USD'|'CDF'>('USD');
  const [amount,setAmount]=useState('0');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [uncertain,setUncertain]=useState(false);
  async function refresh(){
    const response=await coreCashSessions(tenantId,branchId);
    if(response.success!==true)throw new Error('Réponse caisse invalide.');
    setSessions(response.sessions.filter(s=>Number(s.user_id)===userId));
  }
  useEffect(()=>{void refresh().catch(e=>setMessage(String(e)));},[tenantId,branchId,userId]);
  async function act(id?:number){
    if(busy)return;
    const value=Number(amount);
    if(!amount.trim()||!Number.isFinite(value)||value<0){setMessage('Montant positif ou nul requis.');return;}
    setBusy(true);setMessage('');
    try{
      const response=id ? await coreCloseCash(tenantId,id,value) : await coreOpenCash(tenantId,branchId,currency,value);
      if(response.success!==true)throw new Error('Accusé caisse invalide.');
      setMessage(id?'Clôture confirmée par Core.':'Ouverture confirmée par Core.');
      await refresh();
    }catch(e){setMessage(`${String(e)} Vérifiez les caisses avant toute nouvelle opération.`);setUncertain(true);}
    finally{setBusy(false);}
  }
  return <section className="border rounded-xl p-3 space-y-2">
    <h3 className="font-bold">Mes caisses · établissement actif</h3>
    <p className="text-xs">Une caisse ouverte dans la devise du paiement est nécessaire. Après ouverture, reprenez les ventes refusées avec le bouton de reprise ci-dessous.</p>
    <select aria-label="Devise caisse" value={currency} onChange={e=>setCurrency(e.target.value as 'USD'|'CDF')}><option value="USD">USD</option><option value="CDF">FC (CDF)</option></select>
    <label> Solde initial / montant compté <input aria-label="Montant caisse" type="number" min="0" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <button type="button" disabled={busy||uncertain||sessions.some(s=>s.status==='OPEN')} onClick={()=>void act()}>Ouvrir la caisse</button>
    <button type="button" disabled={busy} onClick={()=>void refresh().then(()=>{setUncertain(false);setMessage('Liste reçue de Core.');}).catch(e=>setMessage(String(e)))}>Actualiser depuis Core</button>
    {message&&<p role="status" className="text-xs">{message}</p>}
    {sessions.map(s=><div key={String(s.id)} className="text-xs border-t py-2">#{String(s.id)} · {String(s.currency)} · {String(s.status)} · initial {String(s.opening_amount)} · clôture {String(s.closing_amount??'—')}
      {s.status==='OPEN'&&<button type="button" disabled={busy||uncertain} onClick={()=>void act(Number(s.id))}>Fermer avec le montant compté</button>}
    </div>)}
  </section>;
}
