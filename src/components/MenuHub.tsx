import React from 'react';
import {
  Truck,
  ShoppingCart,
  CreditCard,
  Layers,
  Receipt,
  BarChart3,
  Settings,
  Code,
  Wifi,
  WifiOff,
  RefreshCw,
  Building,
  ShieldCheck,
  ChevronRight,
  Database,
  Printer,
  DollarSign,
  Download,
  Smartphone,
  ClipboardList,
  AlertTriangle,
  Gift,
  Ship,
  Languages,
} from 'lucide-react';
import { User, CompanySettings, SyncStatusInfo } from '../types';
import { useLanguage } from '../i18n';

interface MenuHubProps {
  onSelectSubModule: (moduleKey: string) => void;
  currentUser: User;
  settings: CompanySettings;
  syncInfo: SyncStatusInfo;
  onToggleOffline: () => void;
  onManualSync: () => void;
  onOpenSettings: () => void;
  onOpenKotlinModal?: () => void;
  onDownloadZip?: () => void;
  onOpenApkModal?: () => void;
}

interface MenuItem {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  onClick?: () => void;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

export const MenuHub: React.FC<MenuHubProps> = ({
  onSelectSubModule,
  currentUser,
  settings,
  syncInfo,
  onToggleOffline,
  onManualSync,
  onOpenSettings,
  onOpenKotlinModal,
  onDownloadZip,
  onOpenApkModal,
}) => {
  const { language, setLanguage, t } = useLanguage();
  const menuSections: MenuSection[] = [
    {
      title: t('Approvisionnements & Achats', 'Supply & Purchasing'),
      items: [
        {
          id: 'achats',
          title: t('Achats & Approvisionnements', 'Purchases & Supply'),
          subtitle: t('Bons de réception, entrées en stock et calcul des frais', 'Receiving notes, stock intake, and cost calculation'),
          icon: Truck,
          color: 'bg-amber-500/10 text-amber-600',
        },
        {
          id: 'cargo',
          title: t('CHIEF ALPHONS Cargo & Suivi Colis', 'CHIEF ALPHONS Cargo & Parcel Tracking'),
          subtitle: t('Expéditions internationales, suivi et paiements', 'International shipping, tracking, and payments'),
          icon: Truck,
          color: 'bg-amber-500/10 text-amber-600',
        },
        {
          id: 'fournisseurs',
          title: t('Fournisseurs & Contacts', 'Suppliers & Contacts'),
          subtitle: t('Répertoire des distributeurs et solde dû', 'Supplier directory and outstanding balance'),
          icon: Building,
          color: 'bg-emerald-500/10 text-emerald-600',
        },
        {
        id: 'import-export',
        title: t('Import-Export & Suivi des Colis', 'Import-Export & Parcel Tracking'),
        subtitle: t('Gestion des colis clients, frais de transport et facturation', 'Customer parcels, shipping costs, and billing'),
        icon: Ship,
        color: 'bg-amber-500/10 text-amber-600',
      },
      ],
    },
    {
      title: t('Finance & Trésorerie', 'Finance & Cash Management'),
      items: [
        {
          id: 'dettes',
          title: t('Module Gestion des Dettes', 'Debt Management'),
          subtitle: t('Créances clients et dettes fournisseurs sans perte d’historique', 'Customer receivables and supplier debts with full history'),
          icon: CreditCard,
          color: 'bg-amber-500/10 text-amber-600',
        },
        {
          id: 'depenses',
          title: t('Dépenses & Charges Caisse', 'Expenses & Cash Charges'),
          subtitle: t('Carburant groupe, salaires, loyer, transport, télécoms', 'Generator fuel, salaries, rent, transport, and telecoms'),
          icon: Receipt,
          color: 'bg-purple-500/10 text-purple-600',
        },
        {
          id: 'rapports',
          title: t('Rapports & États Comptables', 'Reports & Financial Statements'),
          subtitle: t('Compte de résultat, export Excel CSV et impression A4', 'Income statement, Excel/CSV export, and A4 printing'),
          icon: BarChart3,
          color: 'bg-amber-500/10 text-amber-600',
        },
      ],
    },
    {
      title: t('Réservations & Opérations de Stock', 'Reservations & Stock Operations'),
      items: [
        {
          id: 'reservations',
          title: t('Réservations & Livraisons clients', 'Customer Reservations & Deliveries'),
          subtitle: t('Réservations, avances, livraisons et annulations', 'Reservations, deposits, deliveries, and cancellations'),
          icon: ClipboardList,
          color: 'bg-amber-500/10 text-amber-700',
        },
        {
          id: 'dommages',
          title: t('Dommages & Pertes de marchandises', 'Damaged & Lost Goods'),
          subtitle: t('Marchandises récupérables, invendables et retours fournisseur', 'Recoverable, unsellable, and supplier-return goods'),
          icon: AlertTriangle,
          color: 'bg-amber-500/10 text-amber-700',
        },
        {
          id: 'sorties-gratuites',
          title: t('Sorties gratuites de stock', 'Free Stock Issues'),
          subtitle: t('Dons, échantillons et distributions sans vente', 'Donations, samples, and non-sale distributions'),
          icon: Gift,
          color: 'bg-emerald-500/10 text-emerald-700',
        },
      ],
    },
    {
      title: t('Contrôle & Traçabilité des Stocks', 'Stock Control & Traceability'),
      items: [
        {
          id: 'mouvements',
          title: t('Mouvements de Stock & Inventaire', 'Stock Movements & Inventory'),
          subtitle: t('Traçabilité des flux et outil de réconciliation physique', 'Stock flow tracking and physical inventory reconciliation'),
          icon: Layers,
          color: 'bg-amber-500/10 text-amber-600',
        },
      ],
    },
    {
      title: t('Système & Architecture Native Android', 'System & Native Android Architecture'),
      items: [
        ...(onOpenApkModal
          ? [
              {
                id: 'apk-export',
                title: t('Installer sur Téléphone & Exporter APK', 'Install on Phone & Export APK'),
                subtitle: t('Installation directe sur Android (PWA) ou génération fichier .apk autonome', 'Install directly on Android (PWA) or generate a standalone .apk'),
                icon: Smartphone,
                color: 'bg-amber-500/10 text-amber-700',
                onClick: onOpenApkModal,
              },
            ]
          : []),
...(currentUser.role === 'ADMIN'
  ? [{
      id: 'settings',
      title: t('Paramètres & Taux de Change', 'Settings & Exchange Rate'),
      subtitle: `1$ = ${settings.exchangeRate} FC • ${settings.timezone}`,
      icon: Settings,
      color: 'bg-slate-500/10 text-slate-700',
      onClick: onOpenSettings,
    }]
  : []),
        ...(onOpenKotlinModal
          ? [
              {
                id: 'kotlin',
                title: t('Code Source Android Kotlin (Jetpack Compose & Room)', 'Android Kotlin Source (Jetpack Compose & Room)'),
                subtitle: t('Consulter et exporter les fichiers Room DAOs, ViewModel et Compose M3', 'View and export Room DAOs, ViewModel, and Compose M3 files'),
                icon: Code,
                color: 'bg-teal-500/10 text-teal-700',
                onClick: onOpenKotlinModal,
              },
            ]
          : []),
        ...(onDownloadZip
          ? [
              {
                id: 'download-zip',
                title: t('Télécharger Code Source Complet (.ZIP)', 'Download Complete Source Code (.ZIP)'),
                subtitle: t('Archive complète prête pour Android Studio ou serveur Web local', 'Complete archive ready for Android Studio or a local web server'),
                icon: Download,
                color: 'bg-emerald-500/10 text-emerald-700',
                onClick: onDownloadZip,
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <div className="space-y-4 pb-20 max-w-4xl mx-auto px-3 sm:px-4 pt-3">
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Languages className="w-4 h-4 text-amber-600" />
          <span>{t('Langue de l’application', 'App language')}</span>
        </div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label={t('Langue de l’application', 'App language')}>
          <button
            type="button"
            onClick={() => setLanguage('fr')}
            aria-pressed={language === 'fr'}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${language === 'fr' ? 'bg-[#0F2444] text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}
          >
            Français
          </button>
          <button
            type="button"
            onClick={() => setLanguage('en')}
            aria-pressed={language === 'en'}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${language === 'en' ? 'bg-[#0F2444] text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}
          >
            English
          </button>
        </div>
      </div>

      {/* Profile & Business Header */}
      <div className="bg-linear-to-r from-[#0F2444] to-[#1E3E62] rounded-3xl p-4 sm:p-5 text-white shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center text-lg font-black text-white shadow-md">
            {currentUser.name.charAt(0)}
          </div>
          <div>
            <h2 className="font-extrabold text-base text-white">{currentUser.name}</h2>
            <p className="text-xs text-amber-200">
              {t('Rôle :', 'Role:')} <span className="font-bold underline">{currentUser.role}</span> • {currentUser.email}
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5">{settings.companyName}</p>
          </div>
        </div>

        {currentUser.role === "ADMIN" && (
        <button
          onClick={onOpenSettings}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-2xl transition"
          title={t('Paramètres', 'Settings')}
        >
          <Settings className="w-5 h-5 text-white" />
        </button>
        )}
      </div>

      {/* Sync Status Banner */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
              syncInfo.status === 'OFFLINE'
                ? 'bg-amber-100 text-amber-800'
                : syncInfo.status === 'SYNCING'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {syncInfo.status === 'OFFLINE' ? (
              <WifiOff className="w-5 h-5" />
            ) : syncInfo.status === 'SYNCING' ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Wifi className="w-5 h-5" />
            )}
          </div>
          <div>
            <h4 className="font-bold text-xs text-slate-900">
              {t('État synchronisation Gestion Entreprise :', 'Business sync status:')}{' '}
              <span className={syncInfo.status === 'OFFLINE' ? 'text-amber-700' : 'text-emerald-700'}>
                {syncInfo.status === 'OFFLINE' ? t('Mode hors ligne (stockage local)', 'Offline mode (local storage)') : t('En ligne', 'Online')}
              </span>
            </h4>
            <p className="text-[11px] text-slate-500">
              {syncInfo.syncProgress
                ? t(`Téléchargement ${syncInfo.syncProgress.collection} · ${syncInfo.syncProgress.recovered} document(s) reçus`, `Downloading ${syncInfo.syncProgress.collection} · ${syncInfo.syncProgress.recovered} document(s) received`)
                : syncInfo.pendingCount > 0
                ? t(`${syncInfo.pendingCount} opération(s) en attente de confirmation serveur`, `${syncInfo.pendingCount} operation(s) awaiting server confirmation`)
                : syncInfo.errorMessage || (syncInfo.status === 'SYNCED' ? t('Synchronisation terminée', 'Synchronization complete') : t('Synchronisation non confirmée', 'Synchronization not confirmed'))}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={onToggleOffline}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-300 hover:bg-slate-50 transition"
          >
            {syncInfo.status === 'OFFLINE' ? t('Passer En Ligne', 'Go Online') : t('Tester Mode Hors-Ligne', 'Test Offline Mode')}
          </button>
          {syncInfo.status !== 'OFFLINE' && (
            <button
              onClick={onManualSync}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs transition"
            >
              {t('Synchroniser', 'Sync Now')}
            </button>
          )}
        </div>
      </div>

      {/* Menu Categories */}
      {menuSections.map((section, sIdx) => (
        <div key={sIdx} className="space-y-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
            {section.title}
          </h3>

          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs divide-y divide-slate-100">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.onClick) {
                      item.onClick();
                    } else {
                      onSelectSubModule(item.id);
                    }
                  }}
                  className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition cursor-pointer group"
                >
                  <div className="flex items-center gap-3 truncate">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${item.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="truncate">
                      <h4 className="font-bold text-xs sm:text-sm text-slate-800 group-hover:text-amber-700 transition truncate">
                        {item.title}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate">{item.subtitle}</p>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition shrink-0" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
