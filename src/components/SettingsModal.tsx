import React, { useState } from 'react';
import {
  Settings as SettingsIcon,
  Save,
  Download,
  Upload,
  RotateCcw,
  Users,
  ShieldCheck,
  Building,
  DollarSign,
  Printer,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { CompanySettings, User, UserRole } from '../types';
import { CompanyPanel } from './CompanyPanel';
import {CoreInvitations} from './CoreInvitations';
import {useCoreSession} from '../core/session';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: CompanySettings;
  onUpdateSettings: (newSettings: CompanySettings) => void;
  users: User[];
  onAddUser: (user: Omit<User, 'id'>, initialPin?: string) => void;
  onChangeUserPin?: (userId: string, newPin: string) => boolean;
  onExportDatabase: () => void;
  onImportDatabase: (jsonStr: string) => boolean | Promise<boolean>;
  onResetDatabase: () => void;
  onClearDatabase?: () => void;
  onDeleteUser?: (userId: string) => void;
  onUpdateUserProfile?: (userId: string, profile: { name: string; email: string; phone: string }) => void;
  currentUserRole: UserRole;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  users,
  onAddUser,
  onChangeUserPin,
  onExportDatabase,
  onImportDatabase,
  onResetDatabase,
  onClearDatabase,
  onDeleteUser,
  onUpdateUserProfile,
  currentUserRole,
}) => {
  const coreSession = useCoreSession();
  const [activeTab, setActiveTab] = useState<'GENERAL' | 'CURRENCY' | 'USERS' | 'COMPANY' | 'BACKUP'>('GENERAL');
  const [formData, setFormData] = useState<CompanySettings>(settings);
  const [successMsg, setSuccessMsg] = useState('');

  // New user form state
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('GESTIONNAIRE');
  const [newUserPin, setNewUserPin] = useState('');

  // Change PIN state
  const [changingPinUserId, setChangingPinUserId] = useState<string | null>(null);
  const [targetNewPin, setTargetNewPin] = useState('');

  if (!isOpen || currentUserRole !== "ADMIN") return null;

  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onUpdateSettings(formData);
      setSuccessMsg('Paramètres enregistrés avec succès !');
      setTimeout(() => setSuccessMsg(''), 2500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Enregistrement impossible.');
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;

    try {
      onAddUser(
        {
          name: newUserName.trim(),
          email: newUserEmail.trim(),
          phone: newUserPhone.trim(),
          role: newUserRole,
          active: true,
        },
        newUserPin.trim() || undefined
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Création impossible.');
      return;
    }

    setNewUserName('');
    setNewUserEmail('');
    setNewUserPhone('');
    setNewUserPin('');
    setSuccessMsg('Utilisateur créé avec son code PIN sécurisé !');
    setTimeout(() => setSuccessMsg(''), 2500);
  };

  const handleChangePinSubmit = (userId: string) => {
    if (!targetNewPin || targetNewPin.length < 4) {
      alert('Le code PIN doit comporter au moins 4 chiffres.');
      return;
    }
    if (onChangeUserPin) {
      try {
        const ok = onChangeUserPin(userId, targetNewPin);
        if (ok) {
          setSuccessMsg('Code PIN modifié avec succès !');
          setChangingPinUserId(null);
          setTargetNewPin('');
          setTimeout(() => setSuccessMsg(''), 2500);
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : 'PIN refusé.');
      }
    }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (content) {
        let ok = false;
        try {
          const parsed = JSON.parse(content);
          const data = parsed?.payload ?? parsed;
          const summary = ['products', 'customers', 'suppliers', 'sales', 'purchases', 'debts']
            .map((key) => `${key}: ${Array.isArray(data?.[key]) ? data[key].length : 'invalide'}`).join('\n');
          if (!window.confirm(`La restauration remplacera les données commerciales locales. Une copie de sécurité sera conservée sur cet appareil.\n\n${summary}\n\nContinuer ?`)) return;
          ok = await onImportDatabase(content);
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Import refusé.');
          return;
        }
        if (ok) {
          alert('Sauvegarde restaurée. Une copie de récupération locale a été conservée.');
          onClose();
        } else {
          alert('Format de fichier de sauvegarde invalide.');
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200 my-auto flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-sky-400" />
            <h3 className="font-bold text-base">Configuration BTA Africa</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-slate-100 p-2 flex gap-1 border-b border-slate-200 text-xs font-bold overflow-x-auto shrink-0">
          <button
            onClick={() => setActiveTab('GENERAL')}
            className={`px-3 py-2 rounded-xl transition shrink-0 ${
              activeTab === 'GENERAL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Profil Entreprise
          </button>
          <button
            onClick={() => setActiveTab('CURRENCY')}
            className={`px-3 py-2 rounded-xl transition shrink-0 ${
              activeTab === 'CURRENCY' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Taux de Change USD/CDF
          </button>
          <button
            onClick={() => setActiveTab('USERS')}
            className={`px-3 py-2 rounded-xl transition shrink-0 ${
              activeTab === 'USERS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Utilisateurs & Rôles ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('COMPANY')}
            className={`px-3 py-2 rounded-xl transition shrink-0 ${
              activeTab === 'COMPANY' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Entreprise & Établissements
          </button>
          <button
            onClick={() => setActiveTab('BACKUP')}
            className={`px-3 py-2 rounded-xl transition shrink-0 ${
              activeTab === 'BACKUP' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Sauvegarde & Données
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {activeTab === 'GENERAL' && (
            <form onSubmit={handleSaveGeneral} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Nom de l'Entreprise *</label>
                <input
                  type="text"
                  required
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 p-3 space-y-2">
                <label className="text-xs font-bold text-slate-700 block">Logo de l’entreprise</label>
                {formData.logoDataUrl && <img src={formData.logoDataUrl} alt="Logo entreprise" className="h-16 max-w-40 object-contain rounded-lg border border-slate-200 p-1 bg-white" />}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="w-full text-xs" onChange={(e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  if (file.size > 8 * 1024 * 1024) { alert('Image trop volumineuse (maximum 8 Mo).'); e.currentTarget.value = ''; return; }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const image = new Image(); image.onload = () => {
                      const canvas = document.createElement('canvas'); const scale = Math.min(1, 480 / Math.max(image.width, image.height));
                      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
                      const ctx = canvas.getContext('2d'); if (!ctx) { alert('Impossible de traiter cette image.'); return; }
                      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                      const data = canvas.toDataURL('image/jpeg', 0.78);
                      if (data.length > 220000) { alert('Logo trop lourd après compression. Choisissez une image plus simple.'); return; }
                      setFormData((old) => ({ ...old, logoDataUrl: data }));
                    }; image.onerror = () => alert('Image illisible.'); image.src = String(reader.result || '');
                  }; reader.readAsDataURL(file); e.currentTarget.value = '';
                }} />
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-bold text-slate-700">Couleur de marque</label>
                  <input aria-label="Couleur de marque" type="color" value={formData.brandColor || '#0F2444'} onChange={(e) => setFormData({ ...formData, brandColor: e.target.value })} className="h-9 w-14 rounded border border-slate-300" />
                </div>
                <button type="button" onClick={() => setFormData({ ...formData, logoDataUrl: undefined, brandColor: '#0F2444' })} className="text-[11px] text-red-600 underline">Retirer le logo / réinitialiser la couleur</button>
                <p className="text-[10px] text-slate-500">Le logo est compressé pour limiter la taille des données synchronisées entre les appareils.</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Slogan commercial</label>
                <input
                  type="text"
                  value={formData.slogan}
                  onChange={(e) => setFormData({ ...formData, slogan: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Téléphone Caisse / Magasin</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Email Contact</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Adresse</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Ville & Pays</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">RCCM</label>
                  <input
                    type="text"
                    value={formData.rccm}
                    onChange={(e) => setFormData({ ...formData, rccm: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-[11px]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">ID. NAT.</label>
                  <input
                    type="text"
                    value={formData.idNat}
                    onChange={(e) => setFormData({ ...formData, idNat: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-[11px]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">NIF</label>
                  <input
                    type="text"
                    value={formData.nif}
                    onChange={(e) => setFormData({ ...formData, nif: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-[11px]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Fuseau Horaire Régional</label>
                <input
                  type="text"
                  disabled
                  value={formData.timezone}
                  className="w-full text-xs p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">Par défaut: Africa/Lubumbashi (CAT GMT+2)</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Message de bas de ticket / Reçu</label>
                <input
                  type="text"
                  value={formData.footerMessage}
                  onChange={(e) => setFormData({ ...formData, footerMessage: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Déconnexion Automatique après Inactivité
                </label>
                <select
                  value={formData.autoLogoutMinutes ?? 15}
                  onChange={(e) =>
                    setFormData({ ...formData, autoLogoutMinutes: parseInt(e.target.value) || 0 })
                  }
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                >
                  <option value={0}>Désactivée (Ne jamais verrouiller)</option>
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={15}>15 minutes (Recommandé)</option>
                  <option value={30}>30 minutes</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Verrouille automatiquement l'accès et exige le code PIN après ce délai d'inactivité
                </p>
              </div>

              <div className="flex justify-end pt-3">
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-2xl text-xs font-bold shadow-md flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  Enregistrer les Modifications
                </button>
              </div>
            </form>
          )}

          {activeTab === 'CURRENCY' && (
            <div className="space-y-4">
              <div className="bg-sky-50 p-4 rounded-2xl border border-sky-200 text-xs text-sky-900 space-y-2">
                <h4 className="font-bold flex items-center gap-1.5 text-sm">
                  <DollarSign className="w-4 h-4 text-sky-600" />
                  Règle d'Immuabilité du Taux de Change
                </h4>
                <p>
                  Lorsque vous modifiez le taux de change du jour, ce nouveau taux s'applique
                  uniquement aux <strong>nouvelles transactions</strong> (ventes, achats, dépenses).
                </p>
                <p className="text-[11px] text-sky-700">
                  Les anciennes factures conservent rigoureusement leur taux historique pour garantir
                  l'exactitude comptable et fiscale.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <label className="text-xs font-bold text-slate-800 block">
                  Taux de Change Actuel (1 USD en Francs Congolais CDF) :
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="10"
                      min="1000"
                      value={formData.exchangeRate}
                      onChange={(e) =>
                        setFormData({ ...formData, exchangeRate: parseInt(e.target.value, 10) || 2800 })
                      }
                      className="w-full text-xl font-black p-3 bg-white border border-slate-300 rounded-xl text-sky-900 focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <span className="font-bold text-sm text-slate-700 shrink-0">CDF / Francs</span>
                </div>

                <div className="text-xs text-slate-600 pt-1">
                  Exemple de conversion : <br />
                  <strong>10.00 $ USD</strong> ={' '}
                  <strong className="text-sky-800">
                    {new Intl.NumberFormat('fr-CD').format(10 * formData.exchangeRate)} FC
                  </strong>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    try {
                      onUpdateSettings(formData);
                      setSuccessMsg(`Nouveau taux de change (1$ = ${formData.exchangeRate} FC) enregistré.`);
                    } catch (err) {
                      alert(err instanceof Error ? err.message : 'Enregistrement impossible.');
                    }
                  }}
                  className="w-full py-2.5 bg-[#0F2444] hover:bg-sky-900 text-white font-bold text-xs rounded-xl shadow-xs transition"
                >
                  Appliquer le Nouveau Taux
                </button>
              </div>
            </div>
          )}

          {activeTab === 'USERS' && (coreSession ? <CoreInvitations key={`${coreSession.me.user.id}-${coreSession.membership.tenantId}`} tenantId={coreSession.membership.tenantId} role={coreSession.membership.role} branches={coreSession.branches}/> :
            <div className="space-y-4">
              {currentUserRole === 'ADMIN' && (
                <form onSubmit={handleCreateUser} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                    Ajouter un Utilisateur / Rôle
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <input
                      type="text"
                      required
                      placeholder="Nom complet..."
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      className="p-2 bg-white border border-slate-300 rounded-xl"
                    />
                    <input
                      type="email"
                      required
                      placeholder="Email de connexion..."
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      className="p-2 bg-white border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <input
                      type="tel"
                      placeholder="Téléphone..."
                      value={newUserPhone}
                      onChange={(e) => setNewUserPhone(e.target.value)}
                      className="p-2 bg-white border border-slate-300 rounded-xl"
                    />
                    <input
                      type="password"
                      maxLength={8}
                      placeholder="Code PIN (4 à 8 chiffres)..."
                      value={newUserPin}
                      onChange={(e) => setNewUserPin(e.target.value.replace(/\D/g, ''))}
                      className="p-2 bg-white border border-slate-300 rounded-xl font-mono text-center tracking-widest"
                    />
                  </div>
                  <div>
                    <select
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                      className="w-full p-2 bg-white border border-slate-300 rounded-xl font-bold text-xs"
                    >
                      <option value="GESTIONNAIRE">GESTIONNAIRE (Stocks, Achats, Clients)</option>
                      <option value="ADMIN">ADMIN (Accès total)</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Le code PIN (4 à 8 chiffres, non trivial) est obligatoire ; il est stocké sous forme hashée avec un sel unique.
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold"
                  >
                    Créer le compte utilisateur
                  </button>
                </form>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Comptes Enregistrés ({users.length})
                </h4>
                {users.map((u) => (
                  <div
                    key={u.id}
                    className="p-3 bg-white border border-slate-200 rounded-2xl space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-900">{u.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {u.email} • {u.phone}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                            u.role === 'ADMIN'
                              ? 'bg-red-100 text-red-800'
                              : u.role === 'GESTIONNAIRE'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {u.role}
                        </span>
                        {(currentUserRole === 'ADMIN') && (
                          <button
                            type="button"
                            onClick={() => {
                              if (changingPinUserId === u.id) {
                                setChangingPinUserId(null);
                              } else {
                                setChangingPinUserId(u.id);
                                setTargetNewPin('');
                              }
                            }}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg border border-slate-300 transition"
                          >
                            {changingPinUserId === u.id ? 'Annuler' : 'Changer PIN'}
                          </button>
                        )}
                        {(currentUserRole === 'ADMIN') && onUpdateUserProfile && (
                          <button
                            type="button"
                            onClick={() => {
                              const name = prompt('Nom complet :', u.name);
                              if (name === null) return;
                              const email = prompt('E-mail :', u.email);
                              if (email === null) return;
                              const phone = prompt('Téléphone :', u.phone);
                              if (phone === null) return;
                              onUpdateUserProfile(u.id, { name, email, phone });
                            }}
                            className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-800 text-[10px] font-bold rounded-lg border border-sky-200 transition"
                          >
                            Modifier
                          </button>
                        )}
                        {(currentUserRole === 'ADMIN') && onDeleteUser && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Supprimer définitivement le compte « ${u.name} » ?`)) onDeleteUser(u.id);
                            }}
                            className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold rounded-lg border border-red-200 transition"
                          >
                            Supprimer
                          </button>
                        )}
                      </div>
                    </div>

                    {changingPinUserId === u.id && (
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-sky-200 flex items-center gap-2 pt-2">
                        <span className="text-[11px] text-slate-600 font-semibold shrink-0">Nouveau PIN :</span>
                        <input
                          type="password"
                          maxLength={8}
                          value={targetNewPin}
                          onChange={(e) => setTargetNewPin(e.target.value.replace(/\D/g, ''))}
                          placeholder="Ex: 8888"
                          className="w-24 p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-center tracking-widest font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => handleChangePinSubmit(u.id)}
                          className="px-3 py-1.5 bg-[#0F2444] text-white rounded-lg text-[11px] font-bold hover:bg-sky-900"
                        >
                          Enregistrer
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'COMPANY' && <CompanyPanel />}

          {activeTab === 'BACKUP' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-800 flex items-center gap-1.5 text-sm">
                  <Download className="w-4 h-4 text-sky-600" />
                  Exporter la Base de Données Complète
                </h4>
                <p className="text-slate-500">
                  Téléchargez un fichier JSON sécurisé contenant l'intégralité de vos produits, ventes,
                  stocks, clients, fournisseurs et créances pour sauvegarde ou archivage.
                </p>
                <button
                  type="button"
                  onClick={onExportDatabase}
                  className="px-4 py-2 bg-[#0F2444] text-white rounded-xl font-bold flex items-center gap-1.5 hover:bg-sky-900"
                >
                  <Download className="w-4 h-4" />
                  Télécharger Sauvegarde JSON
                </button>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-800 flex items-center gap-1.5 text-sm">
                  <Upload className="w-4 h-4 text-emerald-600" />
                  Restaurer depuis un Fichier de Sauvegarde
                </h4>
                <p className="text-slate-500">
                  Importez une sauvegarde précédemment exportée pour restaurer l'état du magasin.
                </p>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileImport}
                  className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"
                />
              </div>

              {currentUserRole === 'ADMIN' && (
                <div className="p-4 bg-red-50 rounded-2xl border border-red-200 space-y-2">
                  <h4 className="font-bold text-red-900 flex items-center gap-1.5 text-sm">
                    <RotateCcw className="w-4 h-4 text-red-600" />
                    Réinitialiser le Jeu de Données de Démo
                  </h4>
                  <p className="text-red-700 text-[11px]">
                    Cette action réinitialise la base de données avec le jeu de données d'origine
                    (Quincaillerie moderne à Lubumbashi).
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Attention: Voulez-vous vraiment réinitialiser toutes les données ?')) {
                        onResetDatabase();
                        alert('Données réinitialisées avec succès.');
                        onClose();
                      }
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700"
                  >
                    Réinitialiser Démo
                  </button>
                  {onClearDatabase && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm('Tout effacer (produits, clients, ventes, achats, dettes...) et repartir à zéro ? Pensez à exporter une sauvegarde avant.') &&
                          confirm('Dernière confirmation : cette action est définitive.')
                        ) {
                          onClearDatabase();
                          alert('Toutes les données ont été effacées. Vous pouvez commencer vos enregistrements.');
                          onClose();
                        }
                      }}
                      className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-black"
                    >
                      Tout effacer (démarrer à zéro)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
