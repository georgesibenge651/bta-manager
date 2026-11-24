import React, {useEffect, useRef, useState} from 'react';
import {coreCashSessions, coreOpenCash, coreCloseCash} from '../core/api';
import {CheckCircle2, CircleDollarSign, AlertCircle, RefreshCw, LockKeyhole, Wallet, X, Info} from 'lucide-react';
import {useLanguage} from '../i18n';

type CashSession = Record<string, unknown>;
type CloseResult = {expected_amount?:number; counted_amount?:number; difference?:number; currency?:string};

const money = (value: unknown, currency: string, locale: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${amount.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency==='CDF'?'FC':'$'}`;
};

export function CoreCashPanel({tenantId,branchId,userId}:{tenantId:number;branchId:number;userId:number}) {
  const {language,t}=useLanguage();
  const locale=language==='fr'?'fr-FR':'en-US';
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
    if(response.success!==true)throw new Error(t('Réponse caisse invalide.','Invalid cash register response.'));
    setSessions(response.sessions.filter(s=>Number(s.user_id)===userId));
  }
  useEffect(()=>{void refresh().then(()=>setUncertain(false)).catch(e=>setMessage(String(e)));},[tenantId,branchId,userId]);

  const openSessions=sessions.filter(s=>s.status==='OPEN');
  const anyOpen=openSessions.length>0;

  async function openCash(){
    if(actionLock.current||uncertain||anyOpen)return;
    const value=Number(openingAmount);
    if(!openingAmount.trim()||!Number.isFinite(value)||value<0){setMessage(t('Saisissez un solde initial valide, supérieur ou égal à zéro.','Enter a valid opening balance greater than or equal to zero.'));return;}
    actionLock.current=true;setBusy(true);setMessage('');setCloseResult(null);
    try{
      await coreOpenCash(tenantId,branchId,currency,value);
      setMessage(t('Ouverture confirmée par Core.','Opening confirmed by Core.'));
      await refresh();
    }catch(e){setMessage(`${String(e)} ${t('Vérifiez les caisses avant toute nouvelle opération.','Check the cash registers before starting another operation.')}`);setUncertain(true);}
    finally{actionLock.current=false;setBusy(false);}
  }

  async function closeCash(){
    if(!closingSession||actionLock.current||uncertain)return;
    const value=Number(closingAmount);
    if(!closingAmount.trim()||!Number.isFinite(value)||value<0){setMessage(t('Saisissez le montant réellement compté avant de clôturer.','Enter the actual counted amount before closing.'));return;}
    actionLock.current=true;setBusy(true);setMessage('');setCloseResult(null);
    try{
      const response=await coreCloseCash(tenantId,Number(closingSession.id),value) as CloseResult & {success?:boolean};
      if(response.success!==true)throw new Error(t('Confirmation de clôture invalide.','Invalid closing confirmation.'));
      setCloseResult(response);
      setMessage(t('Clôture confirmée par Core.','Closing confirmed by Core.'));
      setClosingSession(null);setClosingAmount('');
      await refresh();
    }catch(e){setMessage(`${String(e)} ${t('Actualisez les caisses avant de réessayer.','Refresh the cash registers before trying again.')}`);setUncertain(true);}
    finally{actionLock.current=false;setBusy(false);}
  }

  const fieldClass='w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100';
  const buttonClass='w-full rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

  return <div className="space-y-4 min-w-0">
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <div className="flex items-start gap-2">
        {uncertain ? <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={19}/> : anyOpen ? <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={19}/> : <Wallet className="text-slate-500 shrink-0 mt-0.5" size={19}/>}
        <div className="min-w-0">
          <p className="font-semibold text-sm text-slate-900">{uncertain?t('État des caisses à vérifier','Cash register status needs verification'):anyOpen?t('Une caisse est actuellement ouverte','A cash register is currently open'):t('Aucune caisse ouverte','No cash register is open')}</p>
          <p className="text-xs text-slate-600 mt-1">{uncertain?t('Actualisez la liste pour confirmer l’état réel auprès du serveur.','Refresh the list to confirm the status with the server.'):anyOpen?t(`Une caisse ${String(openSessions[0].currency)} est ouverte (#${String(openSessions[0].id)}). Fermez-la avant d’en ouvrir une autre.`,`A ${String(openSessions[0].currency)} cash register is open (#${String(openSessions[0].id)}). Close it before opening another.`):t('Ouvrez une caisse dans la devise utilisée pour recevoir un paiement immédiat.','Open a cash register in the currency you use to receive immediate payments.')}</p>
        </div>
      </div>
    </div>

    <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2"><CircleDollarSign className="text-emerald-700" size={19}/><h4 className="font-bold text-sm text-slate-900">{t('Ouverture d’une caisse','Open a cash register')}</h4></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block min-w-0 space-y-1.5"><span className="text-xs font-semibold text-slate-700">{t('Devise','Currency')}</span>
          <select className={fieldClass} aria-label={t('Devise caisse','Cash register currency')} value={currency} onChange={e=>setCurrency(e.target.value as 'USD'|'CDF')}><option value="USD">USD · {t('Dollar américain','US dollar')}</option><option value="CDF">CDF · {t('Franc congolais','Congolese franc')}</option></select>
        </label>
        <label className="block min-w-0 space-y-1.5"><span className="text-xs font-semibold text-slate-700">{t('Solde initial','Opening balance')}</span>
          <input className={fieldClass} aria-label={t('Solde initial','Opening balance')} type="number" min="0" step="any" value={openingAmount} onChange={e=>setOpeningAmount(e.target.value)} inputMode="decimal"/>
        </label>
      </div>
      <button type="button" disabled={busy||uncertain||anyOpen} onClick={()=>void openCash()} className={`${buttonClass} ${anyOpen?'bg-slate-100 text-slate-400':'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
        <span className="inline-flex items-center justify-center gap-2"><CircleDollarSign size={17}/>{anyOpen?t('Une caisse est déjà ouverte','A cash register is already open'):t('Ouvrir la caisse','Open cash register')+' '+currency}</span>
      </button>
    </section>

    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-sm text-slate-900">{t('Mes sessions de caisse','My cash register sessions')}</h4><span className="text-xs text-slate-500">{sessions.length} {t('session(s)','session(s)')}</span></div>
    {sessions.length===0&&!uncertain&&<p className="text-xs text-slate-500 rounded-lg bg-slate-50 p-3">{t('Aucune session de caisse enregistrée pour cet utilisateur dans cet établissement.','No cash register sessions are recorded for this user at this branch.')}</p>}
    {sessions.map(s=><article key={String(s.id)} className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-bold text-sm text-slate-900">{t('Caisse n°','Register #')} {String(s.id)} · {String(s.currency)}</div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${s.status==='OPEN'?'bg-emerald-100 text-emerald-800':'bg-slate-100 text-slate-600'}`}>{s.status==='OPEN'?t('OUVERTE','OPEN'):t('FERMÉE','CLOSED')}</span></div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-slate-50 p-3"><span className="block text-slate-500 mb-1">{t('Solde initial','Opening balance')}</span><strong className="text-slate-900">{money(s.opening_amount,String(s.currency),locale)}</strong></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="block text-slate-500 mb-1">{t('Montant de clôture','Closing amount')}</span><strong className="text-slate-900">{s.closing_amount===null||s.closing_amount===undefined?t('Non clôturée','Not closed'):money(s.closing_amount,String(s.currency),locale)}</strong></div>
      </div>
      {s.status==='OPEN'&&<button type="button" disabled={busy||uncertain} onClick={()=>{setClosingSession(s);setClosingAmount('');setCloseResult(null);setMessage('');}} className={`${buttonClass} bg-[#0F2444] text-white hover:bg-slate-900`}><span className="inline-flex items-center justify-center gap-2"><LockKeyhole size={16}/>{t('Préparer la clôture','Prepare to close')}</span></button>}
    </article>)}

    {closingSession&&<div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 sm:p-4 space-y-3" role="region" aria-label={t('Formulaire de clôture','Closing form')}>
      <div className="flex items-center justify-between gap-2"><div><h4 className="font-bold text-sm text-amber-950">{t('Clôturer la caisse n°','Close register #')} {String(closingSession.id)}</h4><p className="text-xs text-amber-800 mt-1">{String(closingSession.currency)} · {t('Comptez l’argent réellement présent.','Count the cash physically present.')}</p></div><button type="button" onClick={()=>setClosingSession(null)} className="rounded-lg p-2 text-amber-900 hover:bg-amber-100" aria-label={t('Annuler la clôture','Cancel closing')}><X size={18}/></button></div>
      <div className="flex items-start gap-2 rounded-xl bg-white/70 p-3 text-xs text-amber-950"><Info size={16} className="shrink-0"/><span>{t('Ne saisissez pas le total des ventes : indiquez tout l’argent physiquement présent dans cette caisse au moment de la fermeture.','Do not enter total sales: enter all the cash physically in this register at the time of closing.')}</span></div>
      <label className="block space-y-1.5"><span className="text-xs font-semibold text-amber-950">{t('Montant réellement compté','Actual counted amount')} ({String(closingSession.currency)})</span><input autoFocus className={fieldClass} type="number" min="0" step="any" inputMode="decimal" placeholder={t('Ex. 125.50','e.g. 125.50')} value={closingAmount} onChange={e=>setClosingAmount(e.target.value)}/></label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><button type="button" disabled={busy||uncertain} onClick={()=>void closeCash()} className={`${buttonClass} bg-amber-800 text-white hover:bg-amber-900`}><span className="inline-flex items-center justify-center gap-2"><LockKeyhole size={16}/>{busy?t('Clôture en cours…','Closing…'):t('Confirmer la clôture','Confirm closing')}</span></button><button type="button" disabled={busy} onClick={()=>setClosingSession(null)} className={`${buttonClass} border border-amber-300 bg-white text-amber-950`}>{t('Annuler','Cancel')}</button></div>
    </div>}

    {closeResult&&<section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:p-4 space-y-2"><div className="flex items-center gap-2 font-bold text-sm text-emerald-900"><CheckCircle2 size={18}/>{t('Clôture enregistrée','Register closed')}</div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-white/80 p-3"><span className="block text-slate-500">{t('Solde théorique','Expected balance')}</span><strong>{money(closeResult.expected_amount,closeResult.currency??'USD',locale)}</strong></div><div className="rounded-lg bg-white/80 p-3"><span className="block text-slate-500">{t('Montant compté','Counted amount')}</span><strong>{money(closeResult.counted_amount,closeResult.currency??'USD',locale)}</strong></div></div><div className="rounded-lg bg-white/80 p-3 text-sm"><span className="text-slate-600">{t('Écart constaté :','Difference:')} </span><strong className={Number(closeResult.difference)<0?'text-rose-700':Number(closeResult.difference)>0?'text-amber-700':'text-emerald-700'}>{money(closeResult.difference,closeResult.currency??'USD',locale)}</strong></div></section>}

    <button type="button" disabled={busy} onClick={()=>void refresh().then(()=>{setUncertain(false);setMessage(t('État actualisé depuis Core.','Status refreshed from Core.'));}).catch(e=>{setMessage(String(e));setUncertain(true);})} className={`${buttonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><span className="inline-flex items-center justify-center gap-2"><RefreshCw size={16} className={busy?'animate-spin':''}/>{t('Actualiser depuis Core','Refresh from Core')}</span></button>
    {message&&<p role="status" className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-900 break-words">{message}</p>}
  </div>;
}
