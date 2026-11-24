import React from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Smartphone,
  Maximize2,
  DollarSign,
  ShieldCheck,
  Building2,
  Download,
  Search,
  ListChecks,
} from 'lucide-react';
import { User, CompanySettings, SyncStatusInfo, UserRole } from '../types';
import type { CoreBranch } from '../core/api';
import { useLanguage } from '../i18n';

interface NavbarProps {
  currentUser: User;
  onSwitchUser: (user: User) => void;
  users: User[];
  settings: CompanySettings;
  syncInfo: SyncStatusInfo;
  onToggleOffline: () => void;
  onManualSync: () => void;
  isMobileFrame: boolean;
  onToggleMobileFrame: () => void;
  onOpenSettings: () => void;
  onDownloadZip?: () => void;
  onOpenGlobalSearch?: () => void;
  onOpenSyncCenter?: () => void;
  tenantName?: string;
  activeBranch?: CoreBranch;
  branches?: CoreBranch[];
  onSelectBranch?: (branchId: number) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  onSwitchUser,
  users,
  settings,
  syncInfo,
  onToggleOffline,
  onManualSync,
  isMobileFrame,
  onToggleMobileFrame,
  onOpenSettings,
  onDownloadZip,
  onOpenGlobalSearch,
  onOpenSyncCenter,
  tenantName,
  activeBranch,
  branches = [],
  onSelectBranch,
}) => {
  const { t } = useLanguage();
  const getRoleBadge = (role: UserRole) => {
    if (role === "ADMIN") {
      return <span className="bg-red-500/20 text-red-200 border border-red-400/40 text-[10px] px-2 py-0.5 rounded-full font-bold">ADMIN</span>;
    }

    if (role === 'CASHIER') return <span className="bg-amber-500/20 text-amber-200 border border-amber-400/40 text-[10px] px-2 py-0.5 rounded-full font-bold">{t('CAISSE', 'CASHIER')}</span>;
    return <span className="bg-amber-500/20 text-amber-200 border border-amber-400/40 text-[10px] px-2 py-0.5 rounded-full font-bold">MANAGER</span>;
  };

  return (
    <header className="bg-[#0B1A30] text-white sticky top-0 z-30 shadow-md border-b border-amber-950">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between gap-2">
        {/* Brand & Store Name */}
        <div onClick={currentUser.role === "ADMIN" ? onOpenSettings : undefined} className="flex items-center gap-2 sm:gap-3 cursor-pointer">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shadow-lg shadow-amber-500/20 ring-2 ring-white/10 shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm sm:text-base tracking-tight text-white flex items-center gap-1">
                CHIEF ALPHONS COMPANY LTD
              </span>
              <span className="bg-amber-400/20 text-amber-300 text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase hidden md:inline">
                {settings.timezone.replace('Africa/', '')}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 truncate max-w-[160px] sm:max-w-xs font-normal">
              {tenantName || settings.companyName}{activeBranch ? ` · ${activeBranch.name}` : ''}
            </p>
          </div>
        </div>

        {/* Center: Exchange Rate Pill & Sync Status */}
        <div className="flex items-center gap-2">
          {/* Exchange Rate Badge */}
          <div
            onClick={currentUser.role === "ADMIN" ? onOpenSettings : undefined}
            className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer text-xs transition"
            title={t('Cliquez pour configurer le taux de change', 'Click to configure the exchange rate')}
          >
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-300 text-[11px]">1$ =</span>
            <span className="font-bold text-amber-300 text-xs">{settings.exchangeRate} FC</span>
          </div>

          {/* Sync & Connectivity Controller */}
          <div className="flex items-center gap-1.5">
            {onOpenSyncCenter && (
              <button onClick={onOpenSyncCenter} className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition" title={t('Historique et résolution des opérations Core', 'Core operation history and resolution')} aria-label={t('Ouvrir le centre de synchronisation', 'Open sync center')}>
                <ListChecks className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onToggleOffline}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition border ${
                syncInfo.status === 'OFFLINE'
                  ? 'bg-amber-950/80 text-amber-300 border-amber-600/50 hover:bg-amber-900'
                  : syncInfo.status === 'SYNCING'
                  ? 'bg-amber-950 text-amber-300 border-amber-500/40 animate-pulse'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40 hover:bg-emerald-900/60'
              }`}
              title={t('Cliquer pour basculer en mode Hors-ligne / En ligne', 'Click to switch between offline and online mode')}
            >
              {syncInfo.status === 'OFFLINE' ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden xs:inline">{t('Hors-Ligne', 'Offline')}</span>
                </>
              ) : syncInfo.status === 'SYNCING' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  <span className="hidden xs:inline">{t('Synchro...', 'Syncing...')}</span>
                </>
              ) : syncInfo.status === 'SYNCED' ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden xs:inline">{t('Synchronisé', 'Synced')}</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden xs:inline">{t('En Ligne', 'Online')}</span>
                </>
              )}

              {syncInfo.pendingCount > 0 && (
                <span className="bg-amber-500 text-black text-[10px] font-black px-1.5 rounded-full ml-0.5">
                  {syncInfo.pendingCount}
                </span>
              )}
            </button>

            {/* Manual Sync Trigger button */}
            {syncInfo.status !== 'OFFLINE' && (
              <button
                onClick={onManualSync}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition"
                title={t('Synchroniser avec Gestion Entreprise', 'Sync with Business Management')}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncInfo.status === 'SYNCING' ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* Right: Global Search, Download ZIP, User Switcher & Mobile Frame Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {activeBranch && branches.length > 1 && onSelectBranch && (
            <select aria-label={t('Établissement actif', 'Active location')} value={activeBranch.id} onChange={e => onSelectBranch(Number(e.target.value))} className="max-w-28 sm:max-w-44 rounded-lg border border-white/15 bg-[#102744] px-2 py-2 text-[11px] text-white">
              {branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          {onOpenGlobalSearch && (
            <button
              onClick={onOpenGlobalSearch}
              className="p-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-400/20 transition"
              title={t('Recherche globale dans CHIEF ALPHONS COMPANY LTD', 'Search CHIEF ALPHONS COMPANY LTD')}
              aria-label={t('Ouvrir la recherche globale', 'Open global search')}
            >
              <Search className="w-4 h-4" />
            </button>
          )}
          {onDownloadZip && (
            <button
              onClick={onDownloadZip}
              className="p-1.5 sm:p-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition border border-emerald-500"
              title={t("Télécharger l'archive ZIP du code source complet", 'Download the complete source code ZIP archive')}
            >
              <Download className="w-4 h-4" />
              <span className="hidden lg:inline text-[11px] font-bold">Code ZIP</span>
            </button>
          )}

          {/* Frame Toggle (desktop preview only) */}
          {import.meta.env.DEV && (
          <button
            onClick={onToggleMobileFrame}
            className={`p-1.5 sm:p-2 rounded-xl text-xs font-semibold flex items-center gap-1 transition border ${
              isMobileFrame
                ? 'bg-amber-500 text-white border-amber-400'
                : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
            }`}
            title={isMobileFrame ? t('Passer en plein écran responsive', 'Switch to responsive fullscreen') : t('Passer en vue mobile Android', 'Switch to Android mobile preview')}
          >
            {isMobileFrame ? (
              <>
                <Maximize2 className="w-4 h-4" />
                <span className="hidden md:inline text-[11px]">{t('Plein écran', 'Fullscreen')}</span>
              </>
            ) : (
              <>
                <Smartphone className="w-4 h-4" />
                <span className="hidden md:inline text-[11px]">{t('Vue Android', 'Android Preview')}</span>
              </>
            )}
          </button>
          )}

          {/* Current user + lock button (switching user requires the PIN of the target account) */}
          <button
            type="button"
            onClick={() => onSwitchUser(currentUser)}
            className="flex items-center gap-2 p-1.5 pl-2 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition"
            title={t("Verrouiller / changer d'utilisateur", 'Lock / switch user')}
          >
            <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-600 flex items-center justify-center text-xs font-bold text-white shadow-sm">
              {currentUser.name.charAt(0)}
            </div>
            <div className="hidden sm:block text-left text-xs leading-none pr-1">
              <p className="font-semibold text-slate-100 truncate max-w-[100px]">{currentUser.name}</p>
              <div className="mt-1">{getRoleBadge(currentUser.role)}</div>
            </div>
            <span className="text-[10px] font-bold text-amber-300 pr-1">{t('Verrouiller', 'Lock')}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
