import React,{useEffect,useRef,useState} from 'react';
import {Share} from '@capacitor/share';
import {coreCreateInvitation,coreInvitations,coreRevokeInvitation,CoreInvitation,CoreRole,CoreBranch,InvitationRole} from '../core/api';
import {useLanguage} from '../i18n';

export function CoreInvitations({tenantId,role,branches}:{tenantId:number;role:CoreRole;branches:CoreBranch[]}){
  const {language,t}=useLanguage();
  const locale=language==='fr'?'fr-FR':'en-US';
  const roles:InvitationRole[]=role==='OWNER'?['ADMIN','MANAGER','CASHIER']:role==='ADMIN'?['MANAGER','CASHIER']:[];
  const [target,setTarget]=useState<InvitationRole>('MANAGER');
  const [selected,setSelected]=useState<number[]>([]);
  const [items,setItems]=useState<CoreInvitation[]>([]);
  const [code,setCode]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const lock=useRef(false);
  const refresh=async()=>{const r=await coreInvitations(tenantId);if(r.success!==true)throw new Error(t('Liste Core invalide.','Invalid Core invitation list.'));setItems(r.invitations);};
  useEffect(()=>{if(roles.length)void refresh().catch(e=>setMessage(String(e)));},[tenantId,role]);
  if(!roles.length)return <p>{t('Les invitations sont réservées à OWNER et ADMIN.','Invitations are only available to OWNER and ADMIN roles.')}</p>;
  const roleLabel=(value:InvitationRole)=>value==='ADMIN'?t('Administrateur','Administrator'):value==='MANAGER'?t('Gestionnaire','Manager'):t('Caissier','Cashier');
  const act=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(`${String(e)} ${t('Actualisez la liste avant de réessayer.','Refresh the list before trying again.')}`);}finally{lock.current=false;setBusy(false);}};
  return <section className="space-y-3">
    <h3 className="font-bold">{t('Inviter un utilisateur Core','Invite a Core user')}</h3>
    <p className="text-xs">{t('Le destinataire choisit « Invitation : nouveau compte » sur l’écran de connexion CHIEF ALPHONS COMPANY LTD et définit son mot de passe. Son PIN reste personnel à son téléphone.','The recipient selects “Invitation: new account” on the CHIEF ALPHONS COMPANY LTD sign-in screen and sets a password. Their PIN remains personal to their phone.')}</p>
    <form className="space-y-2" onSubmit={e=>{e.preventDefault();void act(async()=>{setCode('');const r=await coreCreateInvitation(tenantId,target,selected);if(!r.success||!r.code||r.invitation.role!==target)throw new Error(t('Rôle non confirmé par Core. Vérifiez la version du correctif et la liste des invitations.','Role was not confirmed by Core. Check the patch version and invitation list.'));setCode(r.code);await refresh();});}}>
      <label>{t('Rôle','Role')} <select aria-label={t('Rôle invité','Invited role')} value={target} onChange={e=>setTarget(e.target.value as InvitationRole)}>{roles.map(r=><option key={r} value={r}>{roleLabel(r)}</option>)}</select></label>
      <fieldset><legend>{t('Établissements autorisés','Authorized branches')}</legend>{branches.map(b=><label key={b.id} className="block"><input type="checkbox" checked={selected.includes(b.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,b.id]:v.filter(id=>id!==b.id))}/>{b.name}</label>)}</fieldset>
      <button disabled={busy||!selected.length||!roles.includes(target)} className="p-2 bg-amber-700 text-white rounded">{t('Créer l’invitation','Create invitation')}</button>
    </form>
    {code&&<div className="space-y-2"><p className="text-xs">{t('Code confidentiel affiché uniquement après création. À transmettre au destinataire.','This confidential code is shown only after creation. Share it with the recipient.')}</p><textarea readOnly aria-label={t('Code invitation','Invitation code')} className="w-full border p-2" value={code}/><button type="button" onClick={()=>void Share.share({title:t('Invitation BTA','BTA invitation'),text:`${t('Installez BTA, puis choisissez « Invitation : nouveau compte ». Code :','Install BTA, then select “Invitation: new account.” Code:')} ${code}\n${t('Compte existant : choisissez « Invitation : compte existant ».','Existing account: select “Invitation: existing account.”')}`}).catch(e=>setMessage(String(e)))}>{t('Partager les informations','Share details')}</button></div>}
    <button type="button" disabled={busy} onClick={()=>void act(refresh)}>{t('Actualiser les invitations','Refresh invitations')}</button>
    {message&&<p role="status" className="text-sm">{message}</p>}
    {items.map(item=>{const expires=Date.parse(item.expires_at.replace(' ','T')+(item.expires_at.includes('T')?'':'Z'));const valid=item.status==='PENDING'&&expires>Date.now();const status=!valid&&item.status==='PENDING'?t('EXPIRÉE','EXPIRED'):item.status==='PENDING'?t('EN ATTENTE','PENDING'):item.status==='REVOKED'?t('RÉVOQUÉE','REVOKED'):item.status==='ACCEPTED'?t('ACCEPTÉE','ACCEPTED'):String(item.status);return <article key={item.id} className="border rounded p-2 text-sm">#{item.id} · {roleLabel(item.role)} · {status} · {t('établissements','branches')} {item.branches.join(', ')} · {t('expiration','expires')} {Number.isNaN(expires)?item.expires_at:new Date(expires).toLocaleString(locale)}
      {valid&&roles.includes(item.role)&&<button type="button" disabled={busy} onClick={()=>void act(async()=>{const r=await coreRevokeInvitation(item.id);if(!r.success)throw new Error(t('Révocation non confirmée.','Revocation was not confirmed.'));await refresh();})}>{t('Révoquer','Revoke')}</button>}
    </article>;})}
  </section>;
}
