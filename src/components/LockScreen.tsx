import React, { useEffect, useState } from 'react';
import { Lock, Delete, AlertCircle, ShieldCheck, User as UserIcon, Cloud, CheckCircle2 } from 'lucide-react';
import { User } from '../types';
import { appRepository } from '../db/storage';
import {
  signInWithEmail,
  signInAnonymously,
  getFirebaseUser,
  signOutFirebase,
} from '../firebase/auth';
import {
  acceptAnonymousInvitation,
} from '../firebase/tenancy';

interface LockScreenProps {
  users: User[];
  companyName: string;
}

export const FirstAdminSetup: React.FC = () => {
  const admin = appRepository.getUsers().find((u) => u.role === 'ADMIN' && u.active !== false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    try {
      if (!admin) throw new Error('Aucun profil administrateur actif n’est disponible.');
      if (pin !== confirmPin) throw new Error('Les deux codes PIN ne correspondent pas.');
      appRepository.initializeFirstAdminPin(admin.id, pin);
    } catch (e) { setError(e instanceof Error ? e.message : 'Initialisation impossible.'); }
  };
  return (
    <div className="min-h-screen bg-[#0B1A30] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-4">
        <h1 className="text-lg font-black text-slate-900">Initialisation du compte administrateur</h1>
        <p className="text-sm text-slate-600">Créez le premier PIN sur cet appareil. Aucun PIN universel n’est fourni. Gardez l’appareil sous votre contrôle pendant cette étape.</p>
        <input aria-label="Nouveau PIN" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="Nouveau PIN (4 à 8 chiffres)" className="w-full border rounded-xl p-3" />
        <input aria-label="Confirmer le PIN" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} placeholder="Confirmer le PIN" className="w-full border rounded-xl p-3" />
        {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
        <button onClick={submit} disabled={pin.length < 4 || confirmPin.length < 4} className="w-full rounded-xl bg-sky-600 text-white p-3 font-bold disabled:opacity-50">Initialiser l’administrateur</button>
      </div>
    </div>
  );
};

/**
 * Full-screen login: choose an account, then enter the PIN.
 * The app content is NOT rendered until a PIN has been verified.
 */
export const LockScreen: React.FC<LockScreenProps> = ({ users, companyName }) => {
  const [selected, setSelected] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [lockedUntil, setLockedUntil] = useState(0);
  const [, setTick] = useState(0);
  const [showFirebaseLink, setShowFirebaseLink] = useState(false);
  const [firebaseEmail, setFirebaseEmail] = useState('');
  const [firebasePassword, setFirebasePassword] = useState('');
  const [firebaseLocalPin, setFirebaseLocalPin] = useState('');
  const [firebaseBusy, setFirebaseBusy] = useState(false);
  const [firebaseMessage, setFirebaseMessage] = useState('');
  const [firebaseError, setFirebaseError] = useState('');
  const [anonymousCode, setAnonymousCode] = useState('');
  const [anonymousBusy, setAnonymousBusy] = useState(false);
  const [anonymousMessage, setAnonymousMessage] = useState('');

  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => {
      setTick((x) => x + 1);
      if (Date.now() >= lockedUntil) {
        setLockedUntil(0);
        setError('');
      }
    }, 500);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const secondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

  const choose = (u: User) => {
    setSelected(u);
    setPin('');
    const remaining = appRepository.getLockoutRemainingMs(u.id);
    setLockedUntil(remaining > 0 ? Date.now() + remaining : 0);
    setError('');
  };

  const press = (d: string) => {
    if (secondsLeft > 0 || pin.length >= 8) return;
    setPin(pin + d);
    setError('');
  };

  const submit = () => {
    if (!selected || pin.length < 4 || secondsLeft > 0) return;
    const res = appRepository.attemptLogin(selected.id, pin);
    if (!res.ok) {
      setPin('');
      setError(res.error || 'Code PIN incorrect.');
      if (res.lockedMs) setLockedUntil(Date.now() + res.lockedMs);
    }
    // on success the repository notifies and App renders the application
  };

  const linkFirebaseAccount = async () => {
    if (!selected) {
      setFirebaseError('Sélectionnez le profil local à associer au compte Firebase.');
      return;
    }
    if (!firebaseEmail.trim() || !firebasePassword || !firebaseLocalPin) {
      setFirebaseError('Saisissez les identifiants Firebase et le PIN local du profil.');
      return;
    }
    if (!appRepository.verifyUserPin(selected.id, firebaseLocalPin)) {
      setFirebaseError('Le PIN local est incorrect.');
      return;
    }

    setFirebaseBusy(true);
    setFirebaseError('');
    setFirebaseMessage('');
    try {
      const account = await signInWithEmail(firebaseEmail, firebasePassword);
      appRepository.linkFirebaseUid(selected.id, account.uid, firebaseLocalPin);
      setFirebasePassword('');
      setFirebaseLocalPin('');
      setFirebaseMessage(`Compte Firebase associé avec succès (${account.email || firebaseEmail.trim()}).`);
    } catch (err) {
      setFirebaseError(err instanceof Error ? err.message : 'Impossible de relier le compte Firebase.');
    } finally {
      setFirebaseBusy(false);
    }
  };

  const activateAnonymousManager = async () => {
    if (!selected || selected.role !== 'GESTIONNAIRE' || selected.firebaseUid) {
      setFirebaseError('Cette activation est réservée à un profil gestionnaire sans compte Firebase associé.');
      return;
    }

    if (pin.length < 4 || secondsLeft > 0) {
      setFirebaseError('Saisissez d’abord le PIN local valide.');
      return;
    }

    if (!anonymousCode.trim()) {
      setFirebaseError('Saisissez le code fourni par Georges.');
      return;
    }

    const pinCheck = appRepository.verifyUserPinWithLockout(selected.id, pin);
    if (!pinCheck.ok) {
      setFirebaseError(pinCheck.error || 'PIN incorrect.');
      setPin('');
      if (pinCheck.lockedMs) {
        setLockedUntil(Date.now() + pinCheck.lockedMs);
      }
      return;
    }

    setAnonymousBusy(true);
    setFirebaseError('');
    setAnonymousMessage('');

    try {
      // Si une activation précédente a déjà créé une identité anonyme,
      // on la réutilise pour permettre la reprise idempotente.
      let account = await getFirebaseUser();

      if (account && !account.isAnonymous) {
        throw new Error(
          'Un compte Firebase avec e-mail est déjà connecté. Déconnectez-le avant d’activer le profil gestionnaire.'
        );
      }

      if (!account) {
        account = await signInAnonymously();
      }

      const uidAlreadyLinked = appRepository.getUsers().some(
        (user) => user.id !== selected.id && user.firebaseUid === account.uid
      );

      if (uidAlreadyLinked) {
        throw new Error('Ce compte Firebase est déjà associé à un autre profil local.');
      }

      await acceptAnonymousInvitation(anonymousCode);

      appRepository.linkFirebaseUid(selected.id, account.uid, pin);

      const login = appRepository.attemptLogin(selected.id, pin);
      if (!login.ok) {
        throw new Error(login.error || 'Activation terminée, mais ouverture de session impossible.');
      }

      setAnonymousMessage('Profil gestionnaire activé avec succès.');
      setAnonymousCode('');
      setPin('');
    } catch (err) {
      setFirebaseError(
        err instanceof Error ? err.message : 'Activation anonyme impossible.',
      );
    } finally {
      setAnonymousBusy(false);
    }
  };

  const roleLabel = (r: string) =>
    r === 'ADMIN' ? 'Administrateur' : r === 'GESTIONNAIRE' ? 'Gestionnaire' : 'Gestionnaire';

  return (
    <div className="min-h-screen bg-[#0B1A30] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="bg-[#0F2444] text-white p-5 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400 mb-2">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="font-extrabold text-base">{companyName}</h1>
          <p className="text-[11px] text-sky-200">Application verrouillée – identifiez-vous</p>
        </div>

        {!selected ? (
          <div className="p-4 space-y-2">
            {users
              .filter((u) => u.active !== false)
              .map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => choose(u)}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl border border-slate-200 hover:bg-slate-50 text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 text-white flex items-center justify-center">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-slate-900">{u.name}</p>
                    <p className="text-[11px] text-slate-500">{roleLabel(u.role)}</p>
                  </div>
                </button>
              ))}
          </div>
        ) : (
          <div className="p-5 text-center space-y-4">
            <div>
              <p className="font-bold text-slate-900 text-sm">{selected.name}</p>
              <button type="button" onClick={() => setSelected(null)} className="text-[11px] text-sky-700 underline">
                Changer d'utilisateur
              </button>
            </div>

            {(
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-left space-y-2">
                <>
                    {selected.firebaseUid && <div className="flex items-center gap-2 text-xs font-semibold text-amber-700"><CheckCircle2 className="w-4 h-4" />Compte Firebase associé : vous pouvez le reconnecter ou remplacer l’association après vérification locale.</div>}
                    <button
                      type="button"
                      onClick={() => {
                        setShowFirebaseLink((value) => !value);
                        setFirebaseError('');
                        setFirebaseMessage('');
                      }}
                      className="w-full flex items-center justify-center gap-2 text-xs font-bold text-sky-800"
                    >
                      <Cloud className="w-4 h-4" />
                      {showFirebaseLink ? 'Masquer le raccordement Firebase' : selected.firebaseUid ? 'Reconnecter ou remplacer le compte Firebase' : 'Associer mon compte Firebase'}
                    </button>
                    {showFirebaseLink && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-600">
                          Associez le compte Firebase de cet utilisateur local. Les autorisations d’entreprise restent contrôlées par Firebase.
                        </p>
                        <input
                          type="email"
                          autoComplete="username"
                          value={firebaseEmail}
                          onChange={(e) => setFirebaseEmail(e.target.value)}
                          placeholder="Adresse e-mail Firebase"
                          className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
                        />
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={firebasePassword}
                          onChange={(e) => setFirebasePassword(e.target.value)}
                          placeholder="Mot de passe Firebase"
                          className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
                        />
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          value={firebaseLocalPin}
                          onChange={(e) => setFirebaseLocalPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          placeholder="PIN local de ce profil"
                          className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
                        />
                        {firebaseError && <p className="text-[11px] font-semibold text-red-600">{firebaseError}</p>}
                        {firebaseMessage && <p className="text-[11px] font-semibold text-emerald-700">{firebaseMessage}</p>}
                        <button
                          type="button"
                          onClick={linkFirebaseAccount}
                          disabled={firebaseBusy || !firebaseEmail.trim() || !firebasePassword || !firebaseLocalPin}
                          className="w-full rounded-xl bg-sky-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                        >
                          {firebaseBusy ? 'Connexion en cours…' : 'Vérifier puis enregistrer l’association'}
                        </button>
                      </div>
                    )}
                  </>
              </div>
            )}

            {selected.role === 'GESTIONNAIRE' && !selected.firebaseUid && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-left space-y-2">
                <p className="text-xs font-extrabold text-emerald-900">
                  Activer l'accès gestionnaire
                </p>
                <p className="text-[11px] text-slate-600">
                  Saisissez le code d'invitation remis par Georges et votre PIN local.
                </p>
                <input
                  type="text"
                  autoComplete="off"
                  value={anonymousCode}
                  onChange={(e) => setAnonymousCode(e.target.value.trim())}
                  placeholder="Code d'invitation"
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
                />
                {firebaseError && (
                  <p role="alert" className="text-[11px] font-semibold text-red-600">{firebaseError}</p>
                )}
                {anonymousMessage && (
                  <p className="text-[11px] font-semibold text-emerald-700">{anonymousMessage}</p>
                )}
                <button
                  type="button"
                  onClick={activateAnonymousManager}
                  disabled={anonymousBusy || pin.length < 4 || secondsLeft > 0 || !anonymousCode.trim()}
                  className="w-full rounded-xl bg-emerald-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {anonymousBusy ? 'Activation en cours…' : 'Activer mon accès gestionnaire'}
                </button>
              </div>
            )}

            <div className="flex justify-center gap-3 py-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full ${pin.length > i ? 'bg-sky-600' : 'border-2 border-slate-300 bg-slate-100'}`}
                />
              ))}
            </div>
            {pin.length > 4 && <p className="text-[10px] text-slate-400">{pin.length} chiffres</p>}

            {(error || secondsLeft > 0) && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-red-600 font-bold bg-red-50 py-1.5 px-3 rounded-xl border border-red-200">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{secondsLeft > 0 ? `Verrouillé : réessayez dans ${secondsLeft} s` : error}</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => press(d)}
                  className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-black text-lg"
                >
                  {d}
                </button>
              ))}
              <button type="button" onClick={() => setPin('')} className="h-12 rounded-2xl bg-slate-100 text-slate-500 font-bold text-xs">
                Effacer
              </button>
              <button type="button" onClick={() => press('0')} className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-black text-lg">
                0
              </button>
              <button type="button" onClick={() => setPin(pin.slice(0, -1))} className="h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center">
                <Delete className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={pin.length < 4 || secondsLeft > 0}
              className="w-full py-3 bg-[#0F2444] disabled:opacity-40 text-white rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              Déverrouiller
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

interface ForcePinChangeProps {
  onDone: () => void;
  onLogout: () => void;
}

/** Shown right after login while the account still uses a well-known demo PIN. */
export const ForcePinChange: React.FC<ForcePinChangeProps> = ({ onDone, onLogout }) => {
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin1 !== pin2) {
      setError('Les deux codes ne correspondent pas.');
      return;
    }
    try {
      appRepository.changeUserPin(appRepository.getCurrentUser().id, pin1);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN refusé.');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#0B1A30] flex items-center justify-center p-4">
      <form onSubmit={save} className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-5 space-y-3">
        <h2 className="font-extrabold text-slate-900 text-base">Choisissez votre code PIN personnel</h2>
        <p className="text-xs text-slate-600">
          Ce compte utilise encore un code par défaut connu de tous. Définissez un nouveau PIN (4 à 8 chiffres, pas de suite
          comme 1234 ni de répétition comme 1111).
        </p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin1}
          onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))}
          placeholder="Nouveau PIN"
          className="w-full p-3 border border-slate-300 rounded-xl text-center tracking-widest font-bold"
          autoFocus
        />
        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin2}
          onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
          placeholder="Confirmer le PIN"
          className="w-full p-3 border border-slate-300 rounded-xl text-center tracking-widest font-bold"
        />
        {error && <p className="text-xs font-bold text-red-600">{error}</p>}
        <button type="submit" className="w-full py-3 bg-[#0F2444] text-white rounded-2xl font-bold text-xs uppercase tracking-wider">
          Enregistrer le PIN
        </button>
        <button type="button" onClick={onLogout} className="w-full text-[11px] text-slate-500 underline">
          Se déconnecter
        </button>
      </form>
    </div>
  );
};
