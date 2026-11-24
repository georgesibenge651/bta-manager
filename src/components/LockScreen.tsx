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
import { useLanguage } from '../i18n';

const localizeLockError = (message: string, t: (french: string, english: string) => string) => {
  const attemptCount = message.match(/^Code PIN incorrect\. (\d+) essai\(s\) restant\(s\)\.$/);
  const retryDelay = message.match(/^Trop de tentatives\. Réessayez dans (\d+) s\.$/);
  if (attemptCount) return t(message, `Incorrect PIN. ${attemptCount[1]} attempt(s) remaining.`);
  if (retryDelay) return t(message, `Too many attempts. Try again in ${retryDelay[1]}s.`);
  const messages: Record<string, string> = {
    'Code PIN incorrect.': t('Code PIN incorrect.', 'Incorrect PIN.'),
    'Compte introuvable ou désactivé.': t('Compte introuvable ou désactivé.', 'Account not found or disabled.'),
    'Trop de tentatives. Compte verrouillé temporairement.': t('Trop de tentatives. Compte verrouillé temporairement.', 'Too many attempts. Account temporarily locked.'),
    'Le compte administrateur est déjà initialisé.': t('Le compte administrateur est déjà initialisé.', 'The administrator account has already been set up.'),
    'Les deux codes PIN ne correspondent pas.': t('Les deux codes PIN ne correspondent pas.', 'The PINs do not match.'),
    'Les deux codes ne correspondent pas.': t('Les deux codes ne correspondent pas.', 'The PINs do not match.'),
    'Choisissez un PIN de 4 à 8 chiffres qui ne soit pas trivial.': t('Choisissez un PIN de 4 à 8 chiffres qui ne soit pas trivial.', 'Choose a non-trivial PIN with 4 to 8 digits.'),
    'Profil administrateur introuvable.': t('Profil administrateur introuvable.', 'Administrator profile not found.'),
    'Un profil administrateur actif est requis.': t('Un profil administrateur actif est requis.', 'An active administrator profile is required.'),
    'Utilisateur local introuvable.': t('Utilisateur local introuvable.', 'Local user not found.'),
    'Identifiant Firebase manquant.': t('Identifiant Firebase manquant.', 'Firebase ID is missing.'),
    'Ce compte Firebase est déjà associé à un autre utilisateur local.': t('Ce compte Firebase est déjà associé à un autre utilisateur local.', 'This Firebase account is already linked to another local user.'),
    'Ce compte Firebase est déjà associé à un autre profil local.': t('Ce compte Firebase est déjà associé à un autre profil local.', 'This Firebase account is already linked to another local profile.'),
    'PIN trop simple : 4 à 8 chiffres, pas de suite (1234), ni répétition (1111), ni PIN par défaut.': t('PIN trop simple : 4 à 8 chiffres, pas de suite (1234), ni répétition (1111), ni PIN par défaut.', 'PIN is too easy: use 4 to 8 digits, avoid sequences (1234), repeated digits (1111), and default PINs.'),
  };
  return messages[message] || message;
};

interface LockScreenProps {
  users: User[];
  companyName: string;
}

export const FirstAdminSetup: React.FC = () => {
  const { t } = useLanguage();
  const admin = appRepository.getUsers().find((u) => u.role === 'ADMIN' && u.active !== false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    try {
      if (!admin) throw new Error(t('Aucun profil administrateur actif n’est disponible.', 'No active administrator profile is available.'));
      if (pin !== confirmPin) throw new Error(t('Les deux codes PIN ne correspondent pas.', 'The PINs do not match.'));
      appRepository.initializeFirstAdminPin(admin.id, pin);
    } catch (e) { setError(e instanceof Error ? localizeLockError(e.message, t) : t('Initialisation impossible.', 'Unable to initialize.')); }
  };
  return (
    <div className="min-h-screen bg-[#0B1A30] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-4">
        <h1 className="text-lg font-black text-slate-900">{t('Initialisation du compte administrateur', 'Set up the administrator account')}</h1>
        <p className="text-sm text-slate-600">{t('Créez le premier PIN sur cet appareil. Aucun PIN universel n’est fourni. Gardez l’appareil sous votre contrôle pendant cette étape.', 'Create the first PIN on this device. No universal PIN is provided. Keep control of the device during this step.')}</p>
        <input aria-label={t('Nouveau PIN', 'New PIN')} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder={t('Nouveau PIN (4 à 8 chiffres)', 'New PIN (4–8 digits)')} className="w-full border rounded-xl p-3" />
        <input aria-label={t('Confirmer le PIN', 'Confirm PIN')} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} placeholder={t('Confirmer le PIN', 'Confirm PIN')} className="w-full border rounded-xl p-3" />
        {error && <p role="alert" className="text-sm font-bold text-red-700">{localizeLockError(error, t)}</p>}
        <button onClick={submit} disabled={pin.length < 4 || confirmPin.length < 4} className="w-full rounded-xl bg-amber-600 text-white p-3 font-bold disabled:opacity-50">{t('Initialiser l’administrateur', 'Set up administrator')}</button>
      </div>
    </div>
  );
};

/**
 * Full-screen login: choose an account, then enter the PIN.
 * The app content is NOT rendered until a PIN has been verified.
 */
export const LockScreen: React.FC<LockScreenProps> = ({ users, companyName }) => {
  const { t } = useLanguage();
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
      setError(localizeLockError(res.error || t('Code PIN incorrect.', 'Incorrect PIN.'), t));
      if (res.lockedMs) setLockedUntil(Date.now() + res.lockedMs);
    }
    // on success the repository notifies and App renders the application
  };

  const linkFirebaseAccount = async () => {
    if (!selected) {
      setFirebaseError(t('Sélectionnez le profil local à associer au compte Firebase.', 'Select the local profile to link to the Firebase account.'));
      return;
    }
    if (!firebaseEmail.trim() || !firebasePassword || !firebaseLocalPin) {
      setFirebaseError(t('Saisissez les identifiants Firebase et le PIN local du profil.', 'Enter the Firebase credentials and this profile’s local PIN.'));
      return;
    }
    if (!appRepository.verifyUserPin(selected.id, firebaseLocalPin)) {
      setFirebaseError(t('Le PIN local est incorrect.', 'The local PIN is incorrect.'));
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
      setFirebaseMessage(t(`Compte Firebase associé avec succès (${account.email || firebaseEmail.trim()}).`, `Firebase account linked successfully (${account.email || firebaseEmail.trim()}).`));
    } catch (err) {
      setFirebaseError(err instanceof Error ? localizeLockError(err.message, t) : t('Impossible de relier le compte Firebase.', 'Unable to link the Firebase account.'));
    } finally {
      setFirebaseBusy(false);
    }
  };

  const activateAnonymousManager = async () => {
    if (!selected || selected.role !== 'GESTIONNAIRE' || selected.firebaseUid) {
      setFirebaseError(t('Cette activation est réservée à un profil gestionnaire sans compte Firebase associé.', 'Activation is only available to manager profiles not linked to a Firebase account.'));
      return;
    }

    if (pin.length < 4 || secondsLeft > 0) {
      setFirebaseError(t('Saisissez d’abord le PIN local valide.', 'Enter a valid local PIN first.'));
      return;
    }

    if (!anonymousCode.trim()) {
      setFirebaseError(t('Saisissez le code fourni par Georges.', 'Enter the code provided by Georges.'));
      return;
    }

    const pinCheck = appRepository.verifyUserPinWithLockout(selected.id, pin);
    if (!pinCheck.ok) {
      setFirebaseError(localizeLockError(pinCheck.error || t('PIN incorrect.', 'Incorrect PIN.'), t));
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
          t('Un compte Firebase avec e-mail est déjà connecté. Déconnectez-le avant d’activer le profil gestionnaire.', 'A Firebase account with an email is already signed in. Sign out before activating the manager profile.')
        );
      }

      if (!account) {
        account = await signInAnonymously();
      }

      const uidAlreadyLinked = appRepository.getUsers().some(
        (user) => user.id !== selected.id && user.firebaseUid === account.uid
      );

      if (uidAlreadyLinked) {
        throw new Error(t('Ce compte Firebase est déjà associé à un autre profil local.', 'This Firebase account is already linked to another local profile.'));
      }

      await acceptAnonymousInvitation(anonymousCode);

      appRepository.linkFirebaseUid(selected.id, account.uid, pin);

      const login = appRepository.attemptLogin(selected.id, pin);
      if (!login.ok) {
        throw new Error(login.error || t('Activation terminée, mais ouverture de session impossible.', 'Activation completed, but sign-in failed.'));
      }

      setAnonymousMessage(t('Profil gestionnaire activé avec succès.', 'Manager profile activated successfully.'));
      setAnonymousCode('');
      setPin('');
    } catch (err) {
      setFirebaseError(
        err instanceof Error ? localizeLockError(err.message, t) : t('Activation anonyme impossible.', 'Unable to activate anonymous account.'),
      );
    } finally {
      setAnonymousBusy(false);
    }
  };

  const roleLabel = (r: string) =>
    r === 'ADMIN' ? t('Administrateur', 'Administrator') : t('Gestionnaire', 'Manager');

  return (
    <div className="min-h-screen bg-[#0B1A30] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="bg-[#0F2444] text-white p-5 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 mb-2">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="font-extrabold text-base">{companyName}</h1>
          <p className="text-[11px] text-amber-200">{t('Application verrouillée – identifiez-vous', 'App locked – sign in')}</p>
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
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-600 text-white flex items-center justify-center">
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
              <button type="button" onClick={() => setSelected(null)} className="text-[11px] text-amber-700 underline">
                {t("Changer d'utilisateur", 'Change user')}
              </button>
            </div>

            {(
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left space-y-2">
                <>
                    {selected.firebaseUid && <div className="flex items-center gap-2 text-xs font-semibold text-amber-700"><CheckCircle2 className="w-4 h-4" />{t('Compte Firebase associé : vous pouvez le reconnecter ou remplacer l’association après vérification locale.', 'Firebase account linked: reconnect it or replace the link after local verification.')}</div>}
                    <button
                      type="button"
                      onClick={() => {
                        setShowFirebaseLink((value) => !value);
                        setFirebaseError('');
                        setFirebaseMessage('');
                      }}
                      className="w-full flex items-center justify-center gap-2 text-xs font-bold text-amber-800"
                    >
                      <Cloud className="w-4 h-4" />
                      {showFirebaseLink ? t('Masquer le raccordement Firebase', 'Hide Firebase connection') : selected.firebaseUid ? t('Reconnecter ou remplacer le compte Firebase', 'Reconnect or replace Firebase account') : t('Associer mon compte Firebase', 'Link my Firebase account')}
                    </button>
                    {showFirebaseLink && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-600">
                          {t('Associez le compte Firebase de cet utilisateur local. Les autorisations d’entreprise restent contrôlées par Firebase.', 'Link this local user to a Firebase account. Company permissions remain managed by Firebase.')}
                        </p>
                        <input
                          type="email"
                          autoComplete="username"
                          value={firebaseEmail}
                          onChange={(e) => setFirebaseEmail(e.target.value)}
                          placeholder={t('Adresse e-mail Firebase', 'Firebase email address')}
                          className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
                        />
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={firebasePassword}
                          onChange={(e) => setFirebasePassword(e.target.value)}
                          placeholder={t('Mot de passe Firebase', 'Firebase password')}
                          className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
                        />
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          value={firebaseLocalPin}
                          onChange={(e) => setFirebaseLocalPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          placeholder={t('PIN local de ce profil', 'Local PIN for this profile')}
                          className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
                        />
                        {firebaseError && <p className="text-[11px] font-semibold text-red-600">{localizeLockError(firebaseError, t)}</p>}
                        {firebaseMessage && <p className="text-[11px] font-semibold text-emerald-700">{firebaseMessage}</p>}
                        <button
                          type="button"
                          onClick={linkFirebaseAccount}
                          disabled={firebaseBusy || !firebaseEmail.trim() || !firebasePassword || !firebaseLocalPin}
                          className="w-full rounded-xl bg-amber-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                        >
                          {firebaseBusy ? t('Connexion en cours…', 'Signing in…') : t('Vérifier puis enregistrer l’association', 'Verify and save link')}
                        </button>
                      </div>
                    )}
                  </>
              </div>
            )}

            {selected.role === 'GESTIONNAIRE' && !selected.firebaseUid && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-left space-y-2">
                <p className="text-xs font-extrabold text-emerald-900">
                  {t("Activer l'accès gestionnaire", 'Activate manager access')}
                </p>
                <p className="text-[11px] text-slate-600">
                  {t("Saisissez le code d'invitation remis par Georges et votre PIN local.", 'Enter the invitation code provided by Georges and your local PIN.')}
                </p>
                <input
                  type="text"
                  autoComplete="off"
                  value={anonymousCode}
                  onChange={(e) => setAnonymousCode(e.target.value.trim())}
                  placeholder={t("Code d'invitation", 'Invitation code')}
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs"
                />
                {firebaseError && (
                  <p role="alert" className="text-[11px] font-semibold text-red-600">{localizeLockError(firebaseError, t)}</p>
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
                  {anonymousBusy ? t('Activation en cours…', 'Activating…') : t('Activer mon accès gestionnaire', 'Activate manager access')}
                </button>
              </div>
            )}

            <div className="flex justify-center gap-3 py-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full ${pin.length > i ? 'bg-amber-600' : 'border-2 border-slate-300 bg-slate-100'}`}
                />
              ))}
            </div>
            {pin.length > 4 && <p className="text-[10px] text-slate-400">{pin.length} {t('chiffres','digits')}</p>}

            {(error || secondsLeft > 0) && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-red-600 font-bold bg-red-50 py-1.5 px-3 rounded-xl border border-red-200">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{secondsLeft > 0 ? t(`Verrouillé : réessayez dans ${secondsLeft} s`, `Locked: try again in ${secondsLeft}s`) : localizeLockError(error, t)}</span>
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
                {t('Effacer', 'Clear')}
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
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              {t('Déverrouiller', 'Unlock')}
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
  const { t } = useLanguage();
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin1 !== pin2) {
      setError(t('Les deux codes ne correspondent pas.', 'The PINs do not match.'));
      return;
    }
    try {
      appRepository.changeUserPin(appRepository.getCurrentUser().id, pin1);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? localizeLockError(err.message, t) : t('PIN refusé.', 'PIN rejected.'));
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#0B1A30] flex items-center justify-center p-4">
      <form onSubmit={save} className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-5 space-y-3">
        <h2 className="font-extrabold text-slate-900 text-base">{t('Choisissez votre code PIN personnel', 'Choose your personal PIN')}</h2>
        <p className="text-xs text-slate-600">
          {t('Ce compte utilise encore un code par défaut connu de tous. Définissez un nouveau PIN (4 à 8 chiffres, pas de suite comme 1234 ni de répétition comme 1111).', 'This account still uses a widely known default code. Set a new PIN (4–8 digits; avoid sequences like 1234 or repeated digits like 1111).')}
        </p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin1}
          onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))}
          placeholder={t('Nouveau PIN', 'New PIN')}
          className="w-full p-3 border border-slate-300 rounded-xl text-center tracking-widest font-bold"
          autoFocus
        />
        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin2}
          onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
          placeholder={t('Confirmer le PIN', 'Confirm PIN')}
          className="w-full p-3 border border-slate-300 rounded-xl text-center tracking-widest font-bold"
        />
        {error && <p className="text-xs font-bold text-red-600">{localizeLockError(error, t)}</p>}
        <button type="submit" className="w-full py-3 bg-[#0F2444] text-white rounded-2xl font-bold text-xs uppercase tracking-wider">
          {t('Enregistrer le PIN', 'Save PIN')}
        </button>
        <button type="button" onClick={onLogout} className="w-full text-[11px] text-slate-500 underline">
          {t('Se déconnecter', 'Sign out')}
        </button>
      </form>
    </div>
  );
};
