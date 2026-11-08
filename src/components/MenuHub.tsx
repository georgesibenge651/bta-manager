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
} from 'lucide-react';
import { User, CompanySettings, SyncStatusInfo } from '../types';

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
  const menuSections: MenuSection[] = [
    {
      title: 'Approvisionnements & Achats',
      items: [
        {
          id: 'achats',
          title: 'Achats & Approvisionnements',
          subtitle: 'Bons de réception, entrées en stock et calcul des frais',
          icon: Truck,
          color: 'bg-blue-500/10 text-blue-600',
        },
        {
          id: 'fournisseurs',
          title: 'Fournisseurs & Contacts',
          subtitle: 'Répertoire des distributeurs et solde dû',
          icon: Building,
          color: 'bg-emerald-500/10 text-emerald-600',
        },
      ],
    },
    {
      title: 'Finance & Trésorerie',
      items: [
        {
          id: 'dettes',
          title: 'Module Gestion des Dettes',
          subtitle: 'Créances clients et dettes fournisseurs sans perte d’historique',
          icon: CreditCard,
          color: 'bg-amber-500/10 text-amber-600',
        },
        {
          id: 'depenses',
          title: 'Dépenses & Charges Caisse',
          subtitle: 'Carburant groupe, salaires, loyer, transport, télécoms',
          icon: Receipt,
          color: 'bg-purple-500/10 text-purple-600',
        },
        {
          id: 'rapports',
          title: 'Rapports & États Comptables',
          subtitle: 'Compte de résultat, export Excel CSV et impression A4',
          icon: BarChart3,
          color: 'bg-sky-500/10 text-sky-600',
        },
      ],
    },
    {
      title: 'Réservations & Opérations de Stock',
      items: [
        {
          id: 'reservations',
          title: 'Réservations & Livraisons clients',
          subtitle: 'Réservations, avances, livraisons et annulations',
          icon: ClipboardList,
          color: 'bg-sky-500/10 text-sky-700',
        },
        {
          id: 'dommages',
          title: 'Dommages & Pertes de marchandises',
          subtitle: 'Marchandises récupérables, invendables et retours fournisseur',
          icon: AlertTriangle,
          color: 'bg-amber-500/10 text-amber-700',
        },
        {
          id: 'sorties-gratuites',
          title: 'Sorties gratuites de stock',
          subtitle: 'Dons, échantillons et distributions sans vente',
          icon: Gift,
          color: 'bg-emerald-500/10 text-emerald-700',
        },
      ],
    },
    {
      title: 'Contrôle & Traçabilité des Stocks',
      items: [
        {
          id: 'mouvements',
          title: 'Mouvements de Stock & Inventaire',
          subtitle: 'Traçabilité des flux et outil de réconciliation physique',
          icon: Layers,
          color: 'bg-indigo-500/10 text-indigo-600',
        },
      ],
    },
    {
      title: 'Système & Architecture Native Android',
      items: [
        ...(onOpenApkModal
          ? [
              {
                id: 'apk-export',
                title: 'Installer sur Téléphone & Exporter APK',
                subtitle: 'Installation directe sur Android (PWA) ou génération fichier .apk autonome',
                icon: Smartphone,
                color: 'bg-sky-500/10 text-sky-700',
                onClick: onOpenApkModal,
              },
            ]
          : []),
...(currentUser.role === 'ADMIN'
  ? [{
      id: 'settings',
      title: 'Paramètres & Taux de Change',
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
                title: 'Code Source Android Kotlin (Jetpack Compose & Room)',
                subtitle: 'Consulter et exporter les fichiers Room DAOs, ViewModel et Compose M3',
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
                title: 'Télécharger Code Source Complet (.ZIP)',
                subtitle: 'Archive complète prête pour Android Studio ou serveur Web local',
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
      {/* Profile & Business Header */}
      <div className="bg-gradient-to-r from-[#0F2444] to-[#1E3E62] rounded-3xl p-4 sm:p-5 text-white shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-500 flex items-center justify-center text-lg font-black text-white shadow-md">
            {currentUser.name.charAt(0)}
          </div>
          <div>
            <h2 className="font-extrabold text-base text-white">{currentUser.name}</h2>
            <p className="text-xs text-sky-200">
              Rôle : <span className="font-bold underline">{currentUser.role}</span> • {currentUser.email}
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5">{settings.companyName}</p>
          </div>
        </div>

        {currentUser.role === "ADMIN" && (
        <button
          onClick={onOpenSettings}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-2xl transition"
          title="Paramètres"
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
                ? 'bg-sky-100 text-sky-800'
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
              État Synchronisation Cloud Firestore :{' '}
              <span className={syncInfo.status === 'OFFLINE' ? 'text-amber-700' : 'text-emerald-700'}>
                {syncInfo.status === 'OFFLINE' ? 'Mode Hors-Ligne (Room DB Local)' : 'Connecté & En Ligne'}
              </span>
            </h4>
            <p className="text-[11px] text-slate-500">
              {syncInfo.syncProgress
                ? `Téléchargement ${syncInfo.syncProgress.collection} · ${syncInfo.syncProgress.recovered} document(s) reçus`
                : syncInfo.pendingCount > 0
                ? `${syncInfo.pendingCount} opération(s) en attente de confirmation serveur`
                : syncInfo.errorMessage || (syncInfo.status === 'SYNCED' ? 'Synchronisation terminée' : 'Synchronisation non confirmée')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={onToggleOffline}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-300 hover:bg-slate-50 transition"
          >
            {syncInfo.status === 'OFFLINE' ? 'Passer En Ligne' : 'Tester Mode Hors-Ligne'}
          </button>
          {syncInfo.status !== 'OFFLINE' && (
            <button
              onClick={onManualSync}
              className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition"
            >
              Synchroniser
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
                      <h4 className="font-bold text-xs sm:text-sm text-slate-800 group-hover:text-sky-700 transition truncate">
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
