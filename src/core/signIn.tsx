import React,{useState} from 'react';
import {CORE_API_BASE} from './api';
import {runNetProbe} from './netProbe';
export function CoreSignIn({onSignIn,onInvitation,error:parentError}:{onSignIn(email:string,password:string):Promise<void>;onInvitation(code:string,name:string,email:string,password:string,existing:boolean):Promise<void>;error?:string}){
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [confirmation,setConfirmation]=useState('');const [name,setName]=useState('');
 const [code,setCode]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('invite')??'');
 const [mode,setMode]=useState<'login'|'register'|'accept'>(()=>window.location.hash.includes('invite=')?'register':'login');
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [probe,setProbe]=useState('');
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{
   if(mode==='login')await onSignIn(email,password);
   else{if(mode==='register'&&password!==confirmation)throw new Error('Les mots de passe diffèrent.');await onInvitation(code.trim(),name,email,password,mode==='accept');}
 }catch(x){setError(x instanceof Error?x.message:'Connexion impossible.');}finally{setBusy(false);}};
 return <main className="min-h-screen bg-[#0B1A30] grid place-items-center p-4"><form onSubmit={submit} className="w-full max-w-sm bg-white rounded-3xl p-6 space-y-4">
   <h1 className="text-xl font-black">BTA Manager</h1><p className="text-sm">Compte Gestion Entreprise</p>
   <select aria-label="Connexion ou invitation" value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setError('');}} className="w-full border p-3"><option value="login">Se connecter</option><option value="register">Invitation : nouveau compte</option><option value="accept">Invitation : compte existant</option></select>
   {mode!=='login'&&<input required aria-label="Code invitation" value={code} onChange={e=>setCode(e.target.value)} placeholder="Code d’invitation" className="w-full border p-3"/>}
   {mode==='register'&&<input required minLength={2} maxLength={150} value={name} onChange={e=>setName(e.target.value)} placeholder="Nom complet" className="w-full border p-3"/>}
   <input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-mail" className="w-full border rounded-xl p-3"/>
   <input required type="password" minLength={mode==='register'?12:undefined} autoComplete={mode==='register'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='register'?'Mot de passe (12 caractères minimum)':'Mot de passe'} className="w-full border rounded-xl p-3"/>
   {mode==='register'&&<input required type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="Confirmer le mot de passe" className="w-full border p-3"/>}
   {(error||parentError)&&<p role="alert" className="text-sm text-red-700">{error||parentError}</p>}
   <button disabled={busy} className="w-full bg-sky-600 text-white rounded-xl p-3 font-bold">{busy?'Traitement…':mode==='login'?'Se connecter':mode==='register'?'Créer mon compte':'Accepter l’invitation'}</button>
   <button type="button" onClick={async()=>{setProbe('Test en cours…');setProbe(await runNetProbe(CORE_API_BASE));}} className="w-full border rounded-xl p-2 text-xs">Diagnostic réseau</button>{probe&&<pre className="text-[10px] whitespace-pre-wrap break-all">{probe}</pre>}
 </form></main>;
}
