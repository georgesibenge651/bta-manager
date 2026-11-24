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
import { useLanguage } from '../i18n';

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
  const { t } = useLanguage();
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
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base sm:text-lg">{t('Installation Mobile & Export APK', 'Mobile installation & APK export')}</h3>
              <p className="text-xs text-amber-200">{t('CHIEF ALPHONS COMPANY LTD pour Android', 'CHIEF ALPHONS COMPANY LTD for Android')}</p>
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
            {t('1. Installation Immédiate (Recommandé)', '1. Instant installation (recommended)')}
          </button>
          <button
            onClick={() => setActiveTab('APK_ONLINE')}
            className={`px-3 py-2 rounded-xl transition shrink-0 flex items-center gap-1.5 ${
              activeTab === 'APK_ONLINE' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-amber-600" />
            {t('2. Générer Fichier .APK', '2. Generate an .APK file')}
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
            {t('4. Vos Propres Données', '4. Your own data')}
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-700 flex-1">
          {activeTab === 'PWA' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-900">
                <h4 className="font-bold text-sm flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-amber-500" />
                  {t('Solution la plus rapide (Aucune compilation nécessaire)', 'Fastest option (no build required)')}
                </h4>
                <p className="text-xs text-amber-800 leading-relaxed">
                  {t('CHIEF ALPHONS COMPANY LTD est conçue comme une Progressive Web App (PWA). Sur n’importe quel téléphone Android (Samsung, Tecno, Infinix, Xiaomi, etc.), Google Chrome installe directement l’application sur votre écran d’accueil avec son icône, son plein écran et son fonctionnement hors-ligne.', 'CHIEF ALPHONS COMPANY LTD is a Progressive Web App (PWA). On any Android phone (Samsung, Tecno, Infinix, Xiaomi, etc.), Google Chrome installs it directly on your home screen with its own icon, full-screen display, and offline support.')}
                </p>
              </div>

              <div className="space-y-3">
                <h5 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">
                  {t('Étapes pour installer sur votre téléphone :', 'How to install on your phone:')}
                </h5>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="w-6 h-6 rounded-full bg-[#0F2444] text-white flex items-center justify-center font-bold text-xs shrink-0">
                    1
                  </div>
                  <div className="space-y-2 flex-1">
                    <p className="font-bold text-slate-800">{t('Ouvrez le lien sur votre smartphone Android :', 'Open the link on your Android phone:')}</p>
                    <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-300">
                      <input
                        type="text"
                        readOnly
                        value={appUrl}
                        className="bg-transparent text-xs text-slate-600 flex-1 outline-hidden select-all"
                      />
                      <button
                        onClick={handleCopyUrl}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? t('Copié !', 'Copied!') : t('Copier', 'Copy')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="w-6 h-6 rounded-full bg-[#0F2444] text-white flex items-center justify-center font-bold text-xs shrink-0">
                    2
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{t('Dans Google Chrome :', 'In Google Chrome:')}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t('Appuyez sur le menu en haut à droite (les ', 'Tap the menu in the top-right corner (the ')}<strong>{t('3 petits points verticaux','three vertical dots')} ⋮</strong>).
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="w-6 h-6 rounded-full bg-[#0F2444] text-white flex items-center justify-center font-bold text-xs shrink-0">
                    3
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{t('Sélectionnez « Installer l’application »', 'Select “Install app”')}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t('(Ou ', '(Or ')}<em>{t('« Ajouter à l’écran d’accueil »', '“Add to Home screen”')}</em>{t('). Android génère automatiquement un ', '). Android automatically creates a ')}<strong>WebAPK</strong>{t(' natif avec l’icône CHIEF ALPHONS COMPANY LTD sur votre bureau mobile !', ' with the CHIEF ALPHONS COMPANY LTD icon on your home screen!')}
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
                  {t('Générer un fichier autonome .APK en ligne (100% Gratuit)', 'Generate a standalone .APK online (100% free)')}
                </h4>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  {t('Si vous souhaitez obtenir un vrai fichier d’installation physique se terminant par ', 'To get an actual installation file ending in ')}<code className="font-bold bg-white/60 px-1 py-0.5 rounded">.apk</code>{t(' pour le distribuer par WhatsApp ou clé USB à vos caissiers sans passer par le Play Store :', ' to share with cashiers through WhatsApp or USB without using the Play Store:')}
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <h5 className="font-bold text-slate-900 text-xs">{t('Méthode avec PWABuilder (Officiel Microsoft) :', 'Using PWABuilder (official Microsoft tool):')}</h5>
                  <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-600">
                    <li>{t('Copiez l’URL de l’application :', 'Copy the app URL:')} <code className="font-mono text-amber-700 bg-amber-50 px-1 rounded">{appUrl}</code></li>
                    <li>{t('Rendez-vous sur le site sécurisé :', 'Go to the secure website:')} <a href="https://www.pwabuilder.com" target="_blank" rel="noopener noreferrer" className="text-amber-600 font-bold underline inline-flex items-center gap-0.5">www.pwabuilder.com <ExternalLink className="w-3 h-3" /></a></li>
                    <li>{t('Collez l’URL et cliquez sur ', 'Paste the URL and click ')}<strong>“Start”</strong>.</li>
                    <li>{t('Cliquez sur ', 'Click ')}<strong>“Package for Android”</strong>{t(' puis ', ' then ')}<strong>“Generate APK”</strong>.</li>
                    <li>{t('Téléchargez votre fichier ', 'Download your ')}<code className="font-bold text-emerald-700">bta-release.apk</code>{t(' prêt à installer !', ' file, ready to install!')}</li>
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
                  {t('Projet Android Natif Prêt (Capacitor & Gradle)', 'Native Android project ready (Capacitor & Gradle)')}
                </h4>
                <p className="text-xs text-teal-800 leading-relaxed">
                  {t('Le dossier ', 'The ')}<code className="font-bold bg-white/70 px-1 py-0.5 rounded text-teal-900">android/</code>{t(' est entièrement configuré avec Gradle, l’', ' folder is fully configured with Gradle, the ')}<code className="font-bold bg-white/70 px-1 py-0.5 rounded text-teal-900">AndroidManifest.xml</code>{t(', le nom ', ', app name ')}<strong>CHIEF ALPHONS COMPANY LTD</strong>{t(' et l’ID ', ' and ID ')}<code className="font-mono text-teal-800 font-bold">com.businessafrica.bta.manager</code>.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={onDownloadZip}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition text-xs sm:text-sm"
                >
                  <Download className="w-4 h-4" />
                  {t('Télécharger le Projet Android Complet (.ZIP - 630 Ko)', 'Download the complete Android project (.ZIP - 630 KB)')}
                </button>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 space-y-2">
                  <p className="font-extrabold text-slate-900 uppercase tracking-wide text-[11px]">
                    {t('Option A : Compilation en Ligne de Commande (Terminal)', 'Option A: Build from the command line (terminal)')}
                  </p>
                  <div className="bg-slate-900 text-emerald-400 font-mono p-2.5 rounded-xl text-[11px] space-y-1">
                    <p className="text-slate-400">{t('# 1. Générer l’APK de test (Debug) :', '# 1. Build a debug APK:')}</p>
                    <p>cd android</p>
                    <p>./gradlew assembleDebug</p>
                    <p className="text-amber-300">{t('# Emplacement du fichier généré :', '# Output file location:')}</p>
                    <p className="text-amber-300">android/app/build/outputs/apk/debug/app-debug.apk</p>
                    <p className="text-slate-400 mt-2">{t('# 2. Générer l’APK de production (Release) :', '# 2. Build a release APK:')}</p>
                    <p>./gradlew assembleRelease</p>
                    <p className="text-amber-300">android/app/build/outputs/apk/release/app-release-unsigned.apk</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 space-y-1.5">
                  <p className="font-extrabold text-slate-900 uppercase tracking-wide text-[11px]">
                    {t('Option B : Ouverture dans Android Studio (Interface Visuelle)', 'Option B: Open in Android Studio (visual interface)')}
                  </p>
                  <p>{t('1. Décompressez l’archive ZIP sur votre machine.', '1. Extract the ZIP archive on your computer.')}</p>
                  <p>{t('2. Lancez Android Studio et choisissez ', '2. Open Android Studio and select ')}<strong>“Open”</strong>{t(' en sélectionnant le dossier ', ', then choose the ')}<code className="font-mono bg-white px-1 border rounded">android</code>{t('.', ' folder.')}</p>
                  <p>{t('3. Menu supérieur : ', '3. From the top menu, select: ')}<strong>Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</strong>.</p>
                  <p>{t('4. Android Studio affiche une notification avec un lien direct ', '4. Android Studio displays a notification with a ')}<strong>“locate”</strong>{t(' pour copier le fichier ', ' link to locate and copy ')}<code className="font-bold text-amber-800">app-debug.apk</code>{t(' vers votre téléphone.', ' to your phone.')}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'DATA' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-900">
                <h4 className="font-bold text-sm flex items-center gap-2 mb-1">
                  <Database className="w-4 h-4 text-emerald-600" />
                  {t('Comment intégrer et utiliser vos propres données', 'How to add and use your own data')}
                </h4>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  {t('Vous n’avez pas besoin de toucher au code informatique pour utiliser CHIEF ALPHONS COMPANY LTD avec vos vrais produits (farine de maïs Candol, huile, riz), vos vrais clients et vos taux de change.', 'You do not need to modify any code to use CHIEF ALPHONS COMPANY LTD with your real products (Candol maize flour, oil, rice), customers, and exchange rates.')}
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-[10px]">1</span>
                    {t('Configurer votre Magasin & Taux de Change', 'Set up your store & exchange rate')}
                  </h5>
                  <p className="text-xs text-slate-600 mt-1">
                    {t('Allez dans ', 'Open ')}<strong>{t('Paramètres', 'Settings')}</strong>{t(' : saisissez le nom de votre quincaillerie/boutique, votre adresse à Lubumbashi, votre numéro de téléphone (pour les reçus WhatsApp) et réglez le taux officiel (ex: ', ': enter your store name, address in Lubumbashi, phone number (for WhatsApp receipts), and official exchange rate (e.g. ')}<strong>1 $ = 2 800 FC</strong>).
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-[10px]">2</span>
                    {t('Enregistrer vos vrais Produits', 'Add your real products')}
                  </h5>
                  <p className="text-xs text-slate-600 mt-1">
                    {t('Dans l’onglet ', 'In the ')}<strong>{t('Produits', 'Products')}</strong>{t(', cliquez sur ', ', select ')}<strong>{t('« + Nouveau Produit »', '“+ New Product”')}</strong>{t(' : entrez le nom (ex : ', ': enter the name (e.g. ')}<em>Farine de maïs sac 25 kg</em>{t('), le prix d’achat fournisseur (21 $) et le barème de vente (18,50 $, 17,50 $, 17 $).', '), supplier purchase price ($21), and tiered sale prices ($18.50, $17.50, and $17).')}
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-[10px]">3</span>
                    {t('Créer vos Fournisseurs & Réceptions (Candol)', 'Add suppliers and deliveries (Candol)')}
                  </h5>
                  <p className="text-xs text-slate-600 mt-1">
                    {t('Dans ', 'In ')}<strong>Menu &gt; {t('Fournisseurs', 'Suppliers')}</strong>{t(', créez « Candol ». Puis dans ', ', add “Candol”. Then in ')}<strong>{t('Achats', 'Purchases')}</strong>{t(', enregistrez la livraison de 1 000 unités avec l’échéance à 3 semaines. Le stock et la dette sont automatiquement mis à jour.', ', record a delivery of 1,000 units with a three-week payment term. Inventory and debt are updated automatically.')}
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-[10px]">4</span>
                    {t('Sauvegarder vos Données en 1 Clic', 'Back up your data in one click')}
                  </h5>
                  <p className="text-xs text-slate-600 mt-1">
                    {t('Dans ', 'In ')}<strong>{t('Paramètres &gt; Sauvegarde', 'Settings > Backup')}</strong>{t(', cliquez sur ', ', select ')}<strong>{t('« Exporter Sauvegarde JSON »', '“Export JSON backup”')}</strong>{t('. Vous avez une copie intégrale de toutes vos ventes, clients et stocks sur votre téléphone ou PC !', '. You will have a complete copy of your sales, customers, and inventory on your phone or computer!')}
                  </p>
                </div>

                <button
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                  className="w-full py-2.5 px-4 bg-[#0F2444] hover:bg-[#1E3E62] text-white rounded-xl font-bold flex items-center justify-center gap-2 text-xs transition mt-2"
                >
                  {t('Ouvrir les Paramètres Maintenant', 'Open settings now')}
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
            <span>{t('Données privées sauvegardées localement', 'Private data stored locally')}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition"
          >
            {t('Fermer', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
