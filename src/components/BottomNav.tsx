import React from 'react';
import { LayoutDashboard, Package, ShoppingCart, Users, Menu as MenuIcon } from 'lucide-react';

export type MainTab = 'accueil' | 'produits' | 'ventes' | 'clients' | 'menu';

interface BottomNavProps {
  currentTab: MainTab;
  onTabChange: (tab: MainTab) => void;
  cartItemCount?: number;
  lowStockCount?: number;
  debtAlertCount?: number;
  visibleTabs?: MainTab[];
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onTabChange,
  cartItemCount = 0,
  lowStockCount = 0,
  debtAlertCount = 0,
  visibleTabs,
}) => {
  const tabs = [
    {
      id: 'accueil' as MainTab,
      label: 'Accueil',
      icon: LayoutDashboard,
      badge: 0,
    },
    {
      id: 'produits' as MainTab,
      label: 'Produits',
      icon: Package,
      badge: lowStockCount,
      badgeColor: 'bg-red-500',
    },
    {
      id: 'ventes' as MainTab,
      label: 'Ventes',
      icon: ShoppingCart,
      badge: cartItemCount,
      badgeColor: 'bg-amber-500',
    },
    {
      id: 'clients' as MainTab,
      label: 'Clients',
      icon: Users,
      badge: debtAlertCount,
      badgeColor: 'bg-amber-500',
    },
    {
      id: 'menu' as MainTab,
      label: 'Menu',
      icon: MenuIcon,
      badge: 0,
    },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 z-40 shadow-lg pb-safe">
      <div className="max-w-md mx-auto flex items-center justify-around px-2 py-1.5 sm:py-2">
        {tabs.filter((tab) => !visibleTabs || visibleTabs.includes(tab.id)).map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center w-16 py-1 rounded-2xl transition-all duration-200 ${
                isActive
                  ? 'text-[#0F2444] scale-105 font-bold'
                  : 'text-slate-500 hover:text-slate-900 font-medium'
              }`}
            >
              <div
                className={`relative p-1.5 rounded-2xl transition-colors ${
                  isActive ? 'bg-amber-100/90 text-amber-800 shadow-sm' : ''
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
                {tab.badge > 0 && (
                  <span
                    className={`absolute -top-1 -right-1.5 text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-sm ${
                      tab.badgeColor || 'bg-amber-500'
                    }`}
                  >
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-0.5 tracking-tight ${isActive ? 'text-[#0F2444]' : 'text-slate-500'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
