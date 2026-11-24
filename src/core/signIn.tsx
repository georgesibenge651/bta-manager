import React,{useState} from 'react';
import {CORE_API_BASE} from './api';
import {runNetProbe} from './netProbe';
import {useLanguage} from '../i18n';
export function CoreSignIn({onSignIn,onInvitation,onOwnerSignUp,error:parentError}:{onSignIn(email:string,password:string):Promise<void>;onInvitation(code:string,name:string,email:string,password:string,existing:boolean):Promise<void>;onOwnerSignUp(name:string,email:string,password:string,company:string,branch:string,licenseCode:string):Promise<void>;error?:string}){
 const {t}=useLanguage();
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [confirmation,setConfirmation]=useState('');const [name,setName]=useState('');const [company,setCompany]=useState('');const [branch,setBranch]=useState(()=>t('Établissement principal','Main branch'));
 const [code,setCode]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('invite')??'');const [licenseCode,setLicenseCode]=useState('');
 const [mode,setMode]=useState<'login'|'register'|'accept'|'owner'>(()=>window.location.hash.includes('invite=')?'register':'login');
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [probe,setProbe]=useState('');
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{
   if(mode==='login')await onSignIn(email,password);
   else if(mode==='owner'){if(password!==confirmation)throw new Error(t('Les mots de passe diffèrent.','Passwords do not match.'));if(!licenseCode.trim())throw new Error(t('Le code de licence CHIEF ALPHONS COMPANY LTD est obligatoire.','The CHIEF ALPHONS COMPANY LTD license code is required.'));await onOwnerSignUp(name,email,password,company,branch,licenseCode.trim());}
   else{if(mode==='register'&&password!==confirmation)throw new Error(t('Les mots de passe diffèrent.','Passwords do not match.'));await onInvitation(code.trim(),name,email,password,mode==='accept');}
 }catch(x){setError(x instanceof Error?x.message:t('Connexion impossible.','Unable to sign in.'));}finally{setBusy(false);}};
 return <main className="min-h-screen bg-[#0B1A30] grid place-items-center p-4"><form onSubmit={submit} className="w-full max-w-sm bg-white rounded-3xl p-6 space-y-4">
   <h1 className="text-xl font-black">CHIEF ALPHONS COMPANY LTD</h1><p className="text-sm">{t('Compte Gestion Entreprise','Business Management account')}</p>
   <select aria-label={t('Connexion ou invitation','Sign in or invitation')} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setError('');}} className="w-full border p-3"><option value="login">{t('Se connecter','Sign in')}</option><option value="owner">{t('Créer une nouvelle entreprise','Create a new company')}</option><option value="register">{t('Invitation : nouveau compte','Invitation: new account')}</option><option value="accept">{t('Invitation : compte existant','Invitation: existing account')}</option></select>
   {(mode==='register'||mode==='accept')&&<input required aria-label={t('Code invitation','Invitation code')} value={code} onChange={e=>setCode(e.target.value)} placeholder={t('Code d’invitation','Invitation code')} className="w-full border p-3"/>}
   {(mode==='register'||mode==='owner')&&<input required minLength={2} maxLength={150} value={name} onChange={e=>setName(e.target.value)} placeholder={t('Nom complet','Full name')} className="w-full border p-3"/>}
   {mode==='owner'&&<><input required value={licenseCode} onChange={e=>setLicenseCode(e.target.value.toUpperCase())} placeholder={t('Code de licence CHIEF ALPHONS COMPANY LTD','CHIEF ALPHONS COMPANY LTD license code')} autoComplete="off" className="w-full border p-3"/><input required minLength={2} maxLength={190} value={company} onChange={e=>setCompany(e.target.value)} placeholder={t('Nom de l’entreprise','Company name')} className="w-full border p-3"/><input required minLength={2} maxLength={150} value={branch} onChange={e=>setBranch(e.target.value)} placeholder={t('Établissement principal','Main branch')} className="w-full border p-3"/></>}
   <input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder={t('E-mail','Email')} className="w-full border rounded-xl p-3"/>
   <input required type="password" minLength={mode==='register'||mode==='owner'?12:undefined} autoComplete={mode==='register'||mode==='owner'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='register'||mode==='owner'?t('Mot de passe (12 caractères minimum)','Password (at least 12 characters)'):t('Mot de passe','Password')} className="w-full border rounded-xl p-3"/>
   {(mode==='register'||mode==='owner')&&<input required type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={t('Confirmer le mot de passe','Confirm password')} className="w-full border p-3"/>}
   {(error||parentError)&&<p role="alert" className="text-sm text-red-700">{error||parentError}</p>}
   <button disabled={busy} className="w-full bg-amber-600 text-white rounded-xl p-3 font-bold">{busy?t('Traitement…','Working…'):mode==='login'?t('Se connecter','Sign in'):mode==='owner'?t('Créer mon entreprise','Create my company'):mode==='register'?t('Créer mon compte','Create my account'):t('Accepter l’invitation','Accept invitation')}</button>
   <button type="button" onClick={async()=>{setProbe(t('Test en cours…','Testing…'));setProbe(await runNetProbe(CORE_API_BASE));}} className="w-full border rounded-xl p-2 text-xs">{t('Diagnostic réseau','Network diagnostics')}</button>{probe&&<pre className="text-[10px] whitespace-pre-wrap break-all">{probe}</pre>}
 </form></main>;
}
