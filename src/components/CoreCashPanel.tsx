import React, {useEffect, useRef, useState} from 'react';
import {coreCashSessions, coreOpenCash, coreCloseCash} from '../core/api';
import {CheckCircle2, CircleDollarSign, AlertCircle, RefreshCw, LockKeyhole, Wallet, X, Info} from 'lucide-react';

type CashSession = Record<string, unknown>;
type CloseResult = {expected_amount?:number; counted_amount?:number; difference?:number; currency?:string};

const money = (value: unknown, currency: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${amount.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency==='CDF'?'FC':'$'}`;
};

export function CoreCashPanel({tenantId,branchId,userId}:{tenantId:number;branchId:number;userId:number}) {
  const [sessions,setSessions]=useState<CashSession[]>([]);
  const [currency,setCurrency]=useState<'USD'|'CDF'>('USD');
  const [openingAmount,setOpeningAmount]=useState('0');
  const [closingSession,setClosingSession]=useState<CashSession|null>(null);
  const [closingAmount,setClosingAmount]=useState('');
  const [closeResult,setCloseResult]=useState<CloseResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [uncertain,setUncertain]=useState(true);
  const actionLock=useRef(false);

  async function refresh(){
    const response=await coreCashSessions(tenantId,branchId);
    if(response.success!==true)throw new Error('Réponse caisse invalide.');
    setSessions(response.sessions.filter(s=>Number(s.user_id)===userId));
  }
  useEffect(()=>{void refresh().then(()=>setUncertain(false)).catch(e=>setMessage(String(e)));},[tenantId,branchId,userId]);

  const openSessions=sessions.filter(s=>s.status==='OPEN');
  const anyOpen=openSessions.length>0;

  async function openCash(){
    if(actionLock.current||uncertain||anyOpen)return;
    const value=Number(openingAmount);
    if(!openingAmount.trim()||!Number.isFinite(value)||value<0){setMessage('Saisissez un solde initial valide, supérieur ou égal à zéro.');return;}
    actionLock.current=true;setBusy(true);setMessage('');setCloseResult(null);
    try{
      await coreOpenCash(tenantId,branchId,currency,value);
      setMessage('Ouverture confirmée par Core.');
      await refresh();
    }catch(e){setMessage(`${String(e)} Vérifiez les caisses avant toute nouvelle opération.`);setUncertain(true);}
    finally{actionLock.current=false;setBusy(false);}
  }

  async function closeCash(){
    if(!closingSession||actionLock.current||uncertain)return;
    const value=Number(closingAmount);
    if(!closingAmount.trim()||!Number.isFinite(value)||value<0){setMessage('Saisissez le montant réellement compté avant de clôturer.');return;}
    actionLock.current=true;setBusy(true);setMessage('');setCloseResult(null);
    try{
      const response=await coreCloseCash(tenantId,Number(closingSession.id),value) as CloseResult & {success?:boolean};
      if(response.success!==true)throw new Error('Confirmation de clôture invalide.');
      setCloseResult(response);
      setMessage('Clôture confirmée par Core.');
      setClosingSession(null);setClosingAmount('');
      await refresh();
    }catch(e){setMessage(`${String(e)} Actualisez les caisses avant de réessayer.`);setUncertain(true);}
    finally{actionLock.current=false;setBusy(false);}
  }

  const fieldClass='w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100';
  const buttonClass='w-full rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

  return <div className="space-y-4 min-w-0">
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <div className="flex items-start gap-2">
        {uncertain ? <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={19}/> : anyOpen ? <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={19}/> : <Wallet className="text-slate-500 shrink-0 mt-0.5" size={19}/>}
        <div className="min-w-0">
          <p className="font-semibold text-sm text-slate-900">{uncertain?'État des caisses à vérifier':anyOpen?'Une caisse est actuellement ouverte':'Aucune caisse ouverte'}</p>
          <p className="text-xs text-slate-600 mt-1">{uncertain?'Actualisez la liste pour confirmer l’état réel auprès du serveur.':anyOpen?`Une caisse ${String(openSessions[0].currency)} est ouverte (#${String(openSessions[0].id)}). Fermez-la avant d’en ouvrir une autre.`:'Ouvrez une caisse dans la devise utilisée pour recevoir un paiement immédiat.'}</p>
        </div>
      </div>
    </div>

    <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2"><CircleDollarSign className="text-emerald-700" size={19}/><h4 className="font-bold text-sm text-slate-900">Ouverture d’une caisse</h4></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block min-w-0 space-y-1.5"><span className="text-xs font-semibold text-slate-700">Devise</span>
          <select className={fieldClass} aria-label="Devise caisse" value={currency} onChange={e=>setCurrency(e.target.value as 'USD'|'CDF')}><option value="USD">USD · Dollar américain</option><option value="CDF">CDF · Franc congolais</option></select>
        </label>
        <label className="block min-w-0 space-y-1.5"><span className="text-xs font-semibold text-slate-700">Solde initial</span>
          <input className={fieldClass} aria-label="Solde initial" type="number" min="0" step="any" value={openingAmount} onChange={e=>setOpeningAmount(e.target.value)} inputMode="decimal"/>
        </label>
      </div>
      <button type="button" disabled={busy||uncertain||anyOpen} onClick={()=>void openCash()} className={`${buttonClass} ${anyOpen?'bg-slate-100 text-slate-400':'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
        <span className="inline-flex items-center justify-center gap-2"><CircleDollarSign size={17}/>{anyOpen?'Une caisse est déjà ouverte':'Ouvrir la caisse '+currency}</span>
      </button>
    </section>

    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-sm text-slate-900">Mes sessions de caisse</h4><span className="text-xs text-slate-500">{sessions.length} session(s)</span></div>
    {sessions.length===0&&!uncertain&&<p className="text-xs text-slate-500 rounded-lg bg-slate-50 p-3">Aucune session de caisse enregistrée pour cet utilisateur dans cet établissement.</p>}
    {sessions.map(s=><article key={String(s.id)} className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-bold text-sm text-slate-900">Caisse n° {String(s.id)} · {String(s.currency)}</div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${s.status==='OPEN'?'bg-emerald-100 text-emerald-800':'bg-slate-100 text-slate-600'}`}>{s.status==='OPEN'?'OUVERTE':'FERMÉE'}</span></div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-slate-50 p-3"><span className="block text-slate-500 mb-1">Solde initial</span><strong className="text-slate-900">{money(s.opening_amount,String(s.currency))}</strong></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="block text-slate-500 mb-1">Montant de clôture</span><strong className="text-slate-900">{s.closing_amount===null||s.closing_amount===undefined?'Non clôturée':money(s.closing_amount,String(s.currency))}</strong></div>
      </div>
      {s.status==='OPEN'&&<button type="button" disabled={busy||uncertain} onClick={()=>{setClosingSession(s);setClosingAmount('');setCloseResult(null);setMessage('');}} className={`${buttonClass} bg-[#0F2444] text-white hover:bg-slate-900`}><span className="inline-flex items-center justify-center gap-2"><LockKeyhole size={16}/>Préparer la clôture</span></button>}
    </article>)}

    {closingSession&&<div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 sm:p-4 space-y-3" role="region" aria-label="Formulaire de clôture">
      <div className="flex items-center justify-between gap-2"><div><h4 className="font-bold text-sm text-amber-950">Clôturer la caisse n° {String(closingSession.id)}</h4><p className="text-xs text-amber-800 mt-1">{String(closingSession.currency)} · Comptez l’argent réellement présent.</p></div><button type="button" onClick={()=>setClosingSession(null)} className="rounded-lg p-2 text-amber-900 hover:bg-amber-100" aria-label="Annuler la clôture"><X size={18}/></button></div>
      <div className="flex items-start gap-2 rounded-xl bg-white/70 p-3 text-xs text-amber-950"><Info size={16} className="shrink-0"/><span>Ne saisissez pas le total des ventes : indiquez tout l’argent physiquement présent dans cette caisse au moment de la fermeture.</span></div>
      <label className="block space-y-1.5"><span className="text-xs font-semibold text-amber-950">Montant réellement compté ({String(closingSession.currency)})</span><input autoFocus className={fieldClass} type="number" min="0" step="any" inputMode="decimal" placeholder="Ex. 125.50" value={closingAmount} onChange={e=>setClosingAmount(e.target.value)}/></label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><button type="button" disabled={busy||uncertain} onClick={()=>void closeCash()} className={`${buttonClass} bg-amber-800 text-white hover:bg-amber-900`}><span className="inline-flex items-center justify-center gap-2"><LockKeyhole size={16}/>{busy?'Clôture en cours…':'Confirmer la clôture'}</span></button><button type="button" disabled={busy} onClick={()=>setClosingSession(null)} className={`${buttonClass} border border-amber-300 bg-white text-amber-950`}>Annuler</button></div>
    </div>}

    {closeResult&&<section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:p-4 space-y-2"><div className="flex items-center gap-2 font-bold text-sm text-emerald-900"><CheckCircle2 size={18}/>Clôture enregistrée</div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-white/80 p-3"><span className="block text-slate-500">Solde théorique</span><strong>{money(closeResult.expected_amount,closeResult.currency??'USD')}</strong></div><div className="rounded-lg bg-white/80 p-3"><span className="block text-slate-500">Montant compté</span><strong>{money(closeResult.counted_amount,closeResult.currency??'USD')}</strong></div></div><div className="rounded-lg bg-white/80 p-3 text-sm"><span className="text-slate-600">Écart constaté : </span><strong className={Number(closeResult.difference)<0?'text-rose-700':Number(closeResult.difference)>0?'text-amber-700':'text-emerald-700'}>{money(closeResult.difference,closeResult.currency??'USD')}</strong></div></section>}

    <button type="button" disabled={busy} onClick={()=>void refresh().then(()=>{setUncertain(false);setMessage('État actualisé depuis Core.');}).catch(e=>{setMessage(String(e));setUncertain(true);})} className={`${buttonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><span className="inline-flex items-center justify-center gap-2"><RefreshCw size={16} className={busy?'animate-spin':''}/>Actualiser depuis Core</span></button>
    {message&&<p role="status" className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-900 break-words">{message}</p>}
  </div>;
}
