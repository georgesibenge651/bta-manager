import React,{useEffect,useRef,useState} from 'react';
import {Share} from '@capacitor/share';
import {coreCreateInvitation,coreInvitations,coreRevokeInvitation,CoreInvitation,CoreRole,CoreBranch,InvitationRole} from '../core/api';

export function CoreInvitations({tenantId,role,branches}:{tenantId:number;role:CoreRole;branches:CoreBranch[]}){
  const roles:InvitationRole[]=role==='OWNER'?['ADMIN','MANAGER','CASHIER']:role==='ADMIN'?['MANAGER','CASHIER']:[];
  const [target,setTarget]=useState<InvitationRole>('MANAGER');
  const [selected,setSelected]=useState<number[]>([]);
  const [items,setItems]=useState<CoreInvitation[]>([]);
  const [code,setCode]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const lock=useRef(false);
  const refresh=async()=>{const r=await coreInvitations(tenantId);if(r.success!==true)throw new Error('Liste Core invalide.');setItems(r.invitations);};
  useEffect(()=>{if(roles.length)void refresh().catch(e=>setMessage(String(e)));},[tenantId,role]);
  if(!roles.length)return <p>Les invitations sont réservées à OWNER et ADMIN.</p>;
  const act=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(`${String(e)} Actualisez la liste avant de réessayer.`);}finally{lock.current=false;setBusy(false);}};
  return <section className="space-y-3">
    <h3 className="font-bold">Inviter un utilisateur Core</h3>
    <p className="text-xs">Le destinataire choisit « Invitation : nouveau compte » sur l’écran de connexion CHIEF ALPHONS COMPANY LTD et définit son mot de passe. Son PIN reste personnel à son téléphone.</p>
    <form className="space-y-2" onSubmit={e=>{e.preventDefault();void act(async()=>{setCode('');const r=await coreCreateInvitation(tenantId,target,selected);if(!r.success||!r.code||r.invitation.role!==target)throw new Error('Rôle non confirmé par Core. Vérifiez la version du correctif et la liste des invitations.');setCode(r.code);await refresh();});}}>
      <label>Rôle <select aria-label="Rôle invité" value={target} onChange={e=>setTarget(e.target.value as InvitationRole)}>{roles.map(r=><option key={r}>{r}</option>)}</select></label>
      <fieldset><legend>Établissements autorisés</legend>{branches.map(b=><label key={b.id} className="block"><input type="checkbox" checked={selected.includes(b.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,b.id]:v.filter(id=>id!==b.id))}/>{b.name}</label>)}</fieldset>
      <button disabled={busy||!selected.length||!roles.includes(target)} className="p-2 bg-sky-700 text-white rounded">Créer l’invitation</button>
    </form>
    {code&&<div className="space-y-2"><p className="text-xs">Code confidentiel affiché uniquement après création. À transmettre au destinataire.</p><textarea readOnly aria-label="Code invitation" className="w-full border p-2" value={code}/><button type="button" onClick={()=>void Share.share({title:'Invitation BTA',text:`Installez BTA, puis choisissez « Invitation : nouveau compte ». Code : ${code}\nCompte existant : choisissez « Invitation : compte existant ».`}).catch(e=>setMessage(String(e)))}>Partager les informations</button></div>}
    <button type="button" disabled={busy} onClick={()=>void act(refresh)}>Actualiser les invitations</button>
    {message&&<p role="status" className="text-sm">{message}</p>}
    {items.map(item=>{const expires=Date.parse(item.expires_at.replace(' ','T')+(item.expires_at.includes('T')?'':'Z'));const valid=item.status==='PENDING'&&expires>Date.now();return <article key={item.id} className="border rounded p-2 text-sm">#{item.id} · {item.role} · {item.status==='PENDING'&&!valid?'EXPIRED':item.status} · branches {item.branches.join(', ')} · expiration {item.expires_at}
      {valid&&roles.includes(item.role)&&<button type="button" disabled={busy} onClick={()=>void act(async()=>{const r=await coreRevokeInvitation(item.id);if(!r.success)throw new Error('Révocation non confirmée.');await refresh();})}>Révoquer</button>}
    </article>;})}
  </section>;
}
