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
} from 'lucide-react';
import { User, CompanySettings, SyncStatusInfo, UserRole } from '../types';

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
}) => {
  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'ADMIN':
      case 'ADMINISTRATEUR':
        return <span className="bg-red-500/20 text-red-200 border border-red-400/40 text-[10px] px-2 py-0.5 rounded-full font-bold">ADMIN</span>;
      case 'GESTIONNAIRE':
      case 'MANAGER':
        return <span className="bg-amber-500/20 text-amber-200 border border-amber-400/40 text-[10px] px-2 py-0.5 rounded-full font-bold">GESTION</span>;
      case 'CAISSIER':
      case 'CASHIER':
      default:
        return <span className="bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 text-[10px] px-2 py-0.5 rounded-full font-bold">CAISSE</span>;
    }
  };

  return (
    <header className="bg-[#0B1A30] text-white sticky top-0 z-30 shadow-md border-b border-sky-950">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between gap-2">
        {/* Brand & Store Name */}
        <div className="flex items-center gap-2 sm:gap-3 cursor-pointer" onClick={onOpenSettings}>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center shadow-lg shadow-sky-500/20 ring-2 ring-white/10 shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm sm:text-base tracking-tight text-white flex items-center gap-1">
                BTA <span className="text-sky-400 font-medium hidden sm:inline">Africa</span>
              </span>
              <span className="bg-sky-400/20 text-sky-300 text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase hidden md:inline">
                {settings.timezone.replace('Africa/', '')}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 truncate max-w-[140px] sm:max-w-xs font-normal">
              {settings.companyName}
            </p>
          </div>
        </div>

        {/* Center: Exchange Rate Pill & Sync Status */}
        <div className="flex items-center gap-2">
          {/* Exchange Rate Badge */}
          <div
            onClick={onOpenSettings}
            className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer text-xs transition"
            title="Cliquez pour configurer le taux de change"
          >
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-300 text-[11px]">1$ =</span>
            <span className="font-bold text-sky-300 text-xs">{settings.exchangeRate} FC</span>
          </div>

          {/* Sync & Connectivity Controller */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggleOffline}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition border ${
                syncInfo.status === 'OFFLINE'
                  ? 'bg-amber-950/80 text-amber-300 border-amber-600/50 hover:bg-amber-900'
                  : syncInfo.status === 'SYNCING'
                  ? 'bg-sky-950 text-sky-300 border-sky-500/40 animate-pulse'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40 hover:bg-emerald-900/60'
              }`}
              title="Cliquer pour basculer en mode Hors-ligne / En ligne"
            >
              {syncInfo.status === 'OFFLINE' ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden xs:inline">Hors-Ligne</span>
                </>
              ) : syncInfo.status === 'SYNCING' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                  <span className="hidden xs:inline">Synchro...</span>
                </>
              ) : syncInfo.status === 'SYNCED' ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden xs:inline">Synchronisé</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden xs:inline">En Ligne</span>
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
                title="Synchroniser avec Firebase"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncInfo.status === 'SYNCING' ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* Right: Download ZIP, User Switcher & Mobile Frame Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {onDownloadZip && (
            <button
              onClick={onDownloadZip}
              className="p-1.5 sm:p-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition border border-emerald-500"
              title="Télécharger l'archive ZIP du code source complet"
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
                ? 'bg-sky-500 text-white border-sky-400'
                : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
            }`}
            title={isMobileFrame ? 'Passer en plein écran responsive' : 'Passer en vue mobile Android'}
          >
            {isMobileFrame ? (
              <>
                <Maximize2 className="w-4 h-4" />
                <span className="hidden md:inline text-[11px]">Plein écran</span>
              </>
            ) : (
              <>
                <Smartphone className="w-4 h-4" />
                <span className="hidden md:inline text-[11px]">Vue Android</span>
              </>
            )}
          </button>
          )}

          {/* Current user + lock button (switching user requires the PIN of the target account) */}
          <button
            type="button"
            onClick={() => onSwitchUser(currentUser)}
            className="flex items-center gap-2 p-1.5 pl-2 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition"
            title="Verrouiller / changer d'utilisateur"
          >
            <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shadow-sm">
              {currentUser.name.charAt(0)}
            </div>
            <div className="hidden sm:block text-left text-xs leading-none pr-1">
              <p className="font-semibold text-slate-100 truncate max-w-[100px]">{currentUser.name}</p>
              <div className="mt-1">{getRoleBadge(currentUser.role)}</div>
            </div>
            <span className="text-[10px] font-bold text-sky-300 pr-1">Verrouiller</span>
          </button>
        </div>
      </div>
    </header>
  );
};
