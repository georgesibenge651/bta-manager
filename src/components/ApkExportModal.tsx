import React, { useState } from 'react';
import {
  Smartphone,
  Download,
  Copy,
  Check,
  ExternalLink,
  X,
  FileCode,
  Layers,
  Database,
  ArrowRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface ApkExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadZip: () => void;
  onOpenSettings: () => void;
}

export const ApkExportModal: React.FC<ApkExportModalProps> = ({
  isOpen,
  onClose,
  onDownloadZip,
  onOpenSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'PWA' | 'APK_ONLINE' | 'STUDIO' | 'DATA'>('PWA');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://ais-pre-tkwvxjg3vlyvjeotwgtadx-411000048867.europe-west2.run.app';

  const handleCopyUrl = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200 my-auto flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#0F2444] text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-300">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base sm:text-lg">Installation Mobile & Export APK</h3>
              <p className="text-xs text-sky-200">BTA Business Transform Africa pour Android</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="bg-slate-100 p-2 flex gap-1 border-b border-slate-200 text-xs font-bold overflow-x-auto shrink-0">
          <button
            onClick={() => setActiveTab('PWA')}
            className={`px-3 py-2 rounded-xl transition shrink-0 flex items-center gap-1.5 ${
              activeTab === 'PWA' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            1. Installation Immédiate (Recommandé)
          </button>
          <button
            onClick={() => setActiveTab('APK_ONLINE')}
            className={`px-3 py-2 rounded-xl transition shrink-0 flex items-center gap-1.5 ${
              activeTab === 'APK_ONLINE' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-sky-600" />
            2. Générer Fichier .APK
          </button>
          <button
            onClick={() => setActiveTab('STUDIO')}
            className={`px-3 py-2 rounded-xl transition shrink-0 flex items-center gap-1.5 ${
              activeTab === 'STUDIO' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-teal-600" />
            3. Android Studio (Kotlin)
          </button>
          <button
            onClick={() => setActiveTab('DATA')}
            className={`px-3 py-2 rounded-xl transition shrink-0 flex items-center gap-1.5 ${
              activeTab === 'DATA' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-emerald-600" />
            4. Vos Propres Données
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-700 flex-1">
          {activeTab === 'PWA' && (
            <div className="space-y-4">
              <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 text-sky-900">
                <h4 className="font-bold text-sm flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-amber-500" />
                  Solution la plus rapide (Aucune compilation nécessaire)
                </h4>
                <p className="text-xs text-sky-800 leading-relaxed">
                  BTA est conçue comme une Progressive Web App (PWA). Sur n’importe quel téléphone Android (Samsung, Tecno, Infinix, Xiaomi, etc.), Google Chrome installe directement l’application sur votre écran d’accueil avec son icône, son plein écran et son fonctionnement hors-ligne.
                </p>
              </div>

              <div className="space-y-3">
                <h5 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">
                  Étapes pour installer sur votre téléphone :
                </h5>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="w-6 h-6 rounded-full bg-[#0F2444] text-white flex items-center justify-center font-bold text-xs shrink-0">
                    1
                  </div>
                  <div className="space-y-2 flex-1">
                    <p className="font-bold text-slate-800">Ouvrez le lien sur votre smartphone Android :</p>
                    <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-300">
                      <input
                        type="text"
                        readOnly
                        value={appUrl}
                        className="bg-transparent text-xs text-slate-600 flex-1 outline-hidden select-all"
                      />
                      <button
                        onClick={handleCopyUrl}
                        className="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? 'Copié !' : 'Copier'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="w-6 h-6 rounded-full bg-[#0F2444] text-white flex items-center justify-center font-bold text-xs shrink-0">
                    2
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">Dans Google Chrome :</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Appuyez sur le menu en haut à droite (les <strong>3 petits points verticaux ⋮</strong>).
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="w-6 h-6 rounded-full bg-[#0F2444] text-white flex items-center justify-center font-bold text-xs shrink-0">
                    3
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">Sélectionnez « Installer l’application »</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      (Ou <em>« Ajouter à l’écran d’accueil »</em>). Android génère automatiquement un <strong>WebAPK natif</strong> avec l’icône BTA sur votre bureau mobile !
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'APK_ONLINE' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-900">
                <h4 className="font-bold text-sm flex items-center gap-2 mb-1">
                  <Smartphone className="w-4 h-4 text-emerald-600" />
                  Générer un fichier autonome .APK en ligne (100% Gratuit)
                </h4>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  Si vous souhaitez obtenir un vrai fichier d’installation physique se terminant par <code className="font-bold bg-white/60 px-1 py-0.5 rounded">.apk</code> pour le distribuer par WhatsApp ou clé USB à vos caissiers sans passer par le Play Store :
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <h5 className="font-bold text-slate-900 text-xs">Méthode avec PWABuilder (Officiel Microsoft) :</h5>
                  <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-600">
                    <li>Copiez l’URL de l’application : <code className="font-mono text-sky-700 bg-sky-50 px-1 rounded">{appUrl}</code></li>
                    <li>Rendez-vous sur le site sécurisé : <a href="https://www.pwabuilder.com" target="_blank" rel="noopener noreferrer" className="text-sky-600 font-bold underline inline-flex items-center gap-0.5">www.pwabuilder.com <ExternalLink className="w-3 h-3" /></a></li>
                    <li>Collez l’URL et cliquez sur <strong>« Start »</strong>.</li>
                    <li>Cliquez sur <strong>« Package for Android »</strong> puis <strong>« Generate APK »</strong>.</li>
                    <li>Téléchargez votre fichier <code className="font-bold text-emerald-700">bta-release.apk</code> prêt à installer !</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'STUDIO' && (
            <div className="space-y-4">
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 text-teal-900">
                <h4 className="font-bold text-sm flex items-center gap-2 mb-1">
                  <FileCode className="w-4 h-4 text-teal-600" />
                  Projet Android Natif Prêt (Capacitor & Gradle)
                </h4>
                <p className="text-xs text-teal-800 leading-relaxed">
                  Le dossier <code className="font-bold bg-white/70 px-1 py-0.5 rounded text-teal-900">android/</code> est 100% configuré avec Gradle, l’<code className="font-bold bg-white/70 px-1 py-0.5 rounded text-teal-900">AndroidManifest.xml</code>, le nom <strong>BTA Manager</strong> et l’ID <code className="font-mono text-teal-800 font-bold">com.businessafrica.bta.manager</code>.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={onDownloadZip}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition text-xs sm:text-sm"
                >
                  <Download className="w-4 h-4" />
                  Télécharger le Projet Android Complet (.ZIP - 630 Ko)
                </button>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 space-y-2">
                  <p className="font-extrabold text-slate-900 uppercase tracking-wide text-[11px]">
                    Option A : Compilation en Ligne de Commande (Terminal)
                  </p>
                  <div className="bg-slate-900 text-emerald-400 font-mono p-2.5 rounded-xl text-[11px] space-y-1">
                    <p className="text-slate-400"># 1. Générer l’APK de test (Debug) :</p>
                    <p>cd android</p>
                    <p>./gradlew assembleDebug</p>
                    <p className="text-sky-300"># Emplacement du fichier généré :</p>
                    <p className="text-amber-300">android/app/build/outputs/apk/debug/app-debug.apk</p>
                    <p className="text-slate-400 mt-2"># 2. Générer l’APK de production (Release) :</p>
                    <p>./gradlew assembleRelease</p>
                    <p className="text-amber-300">android/app/build/outputs/apk/release/app-release-unsigned.apk</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 space-y-1.5">
                  <p className="font-extrabold text-slate-900 uppercase tracking-wide text-[11px]">
                    Option B : Ouverture dans Android Studio (Interface Visuelle)
                  </p>
                  <p>1. Décompressez l’archive ZIP sur votre machine.</p>
                  <p>2. Lancez Android Studio et choisissez <strong>« Open »</strong> en sélectionnant le dossier <code className="font-mono bg-white px-1 border rounded">android</code>.</p>
                  <p>3. Menu supérieur : <strong>Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</strong>.</p>
                  <p>4. Android Studio affiche une notification avec un lien direct <strong>« locate »</strong> pour copier le fichier <code className="font-bold text-sky-800">app-debug.apk</code> vers votre téléphone.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'DATA' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-900">
                <h4 className="font-bold text-sm flex items-center gap-2 mb-1">
                  <Database className="w-4 h-4 text-emerald-600" />
                  Comment intégrer et utiliser vos propres données
                </h4>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  Vous n’avez pas besoin de toucher au code informatique pour utiliser BTA avec vos vrais produits (farine de maïs Candol, huile, riz), vos vrais clients et vos taux de change.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-[10px]">1</span>
                    Configurer votre Magasin & Taux de Change
                  </h5>
                  <p className="text-xs text-slate-600 mt-1">
                    Allez dans <strong>Paramètres</strong> : saisissez le nom de votre quincaillerie/boutique, votre adresse à Lubumbashi, votre numéro de téléphone (pour les reçus WhatsApp) et réglez le taux officiel (ex: <strong>1 $ = 2 800 FC</strong>).
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-[10px]">2</span>
                    Enregistrer vos vrais Produits
                  </h5>
                  <p className="text-xs text-slate-600 mt-1">
                    Dans l’onglet <strong>Produits</strong>, cliquez sur <strong>« + Nouveau Produit »</strong> : entrez le nom (ex : <em>Farine de maïs sac 25 kg</em>), le prix d'achat fournisseur (21 $) et le barème de vente (18,50 $, 17,50 $, 17 $).
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-[10px]">3</span>
                    Créer vos Fournisseurs & Réceptions (Candol)
                  </h5>
                  <p className="text-xs text-slate-600 mt-1">
                    Dans <strong>Menu &gt; Fournisseurs</strong>, créez « Candol ». Puis dans <strong>Achats</strong>, enregistrez la livraison de 1 000 unités avec l'échéance à 3 semaines. Le stock et la dette sont automatiquement mis à jour.
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-[10px]">4</span>
                    Sauvegarder vos Données en 1 Clic
                  </h5>
                  <p className="text-xs text-slate-600 mt-1">
                    Dans <strong>Paramètres &gt; Sauvegarde</strong>, cliquez sur <strong>« Exporter Sauvegarde JSON »</strong>. Vous avez une copie intégrale de toutes vos ventes, clients et stocks sur votre téléphone ou PC !
                  </p>
                </div>

                <button
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                  className="w-full py-2.5 px-4 bg-[#0F2444] hover:bg-[#1E3E62] text-white rounded-xl font-bold flex items-center justify-center gap-2 text-xs transition mt-2"
                >
                  Ouvrir les Paramètres Maintenant
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Données privées sauvegardées localement</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
