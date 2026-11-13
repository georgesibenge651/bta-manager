import React, { useState, useEffect, useMemo } from 'react';
import { appRepository } from './db/storage';
import {
  Product,
  Category,
  Customer,
  Supplier,
  Sale,
  Purchase,
  StockMovement,
  Expense,
  DebtRecord,
  CompanySettings,
  User,
  SyncStatusInfo,
  PaymentMethod,
  StockMovementType,
} from './types';
import { Navbar } from './components/Navbar';
import { BottomNav, MainTab } from './components/BottomNav';
import { Dashboard } from './components/Dashboard';
import { Products } from './components/Products';
import { SalesPOS } from './components/SalesPOS';
import { Customers } from './components/Customers';
import { MenuHub } from './components/MenuHub';
import { Suppliers } from './components/Suppliers';
import { Purchases } from './components/Purchases';
import { Debts } from './components/Debts';
import { StockMovements } from './components/StockMovements';
import { Expenses } from './components/Expenses';
import { Reports } from './components/Reports';
import { SettingsModal } from './components/SettingsModal';
import { ReceiptModal } from './components/ReceiptModal';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { KotlinSourceModal } from './components/KotlinSourceModal';
import { ApkExportModal } from './components/ApkExportModal';
import { GlobalSearch } from './components/GlobalSearch';
import { NewOperations } from './components/NewOperations';
import { CoreSyncCenter } from './components/CoreSyncCenter';
import { ArrowLeft } from 'lucide-react';
import { generateProjectZip, downloadProjectZip } from './utils/exportZip';
import { App as CapacitorApp } from '@capacitor/app';
import { ForcePinChange } from './components/LockScreen';
import { IS_DEV } from './utils/config';
import { saveTextFile } from './utils/files';
import { CoreSessionGate, useCoreSession } from './core/session';

/** Runs a repository action; permission/validation errors are shown to the user instead of crashing. */
function guard<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    alert(e instanceof Error ? e.message : 'Action impossible.');
    return undefined;
  }
}

function BtaApp() {
  // Database reactive state
  const [dbState, setDbState] = useState(() => appRepository.getState());
  const isAuthenticated = appRepository.isAuthenticated();
  const coreSession = useCoreSession();
  const cloudContext = coreSession ? { tenantId: String(coreSession.membership.tenantId), branchId: String(coreSession.branch.id) } : null;
  const remoteAccess = coreSession ? { loading: false, permissions: coreSession.permissions } : { loading: true, permissions: [] as string[] };

  // Subscribe to Repository changes
  useEffect(() => {
    const unsubscribe = appRepository.subscribe(() => {
      setDbState({ ...appRepository.getState() });
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (coreSession && !isAuthenticated) appRepository.activateCoreUser({ id: coreSession.me.user.id, name: coreSession.me.user.name, email: coreSession.me.user.email, role: coreSession.membership.role, tenantId: coreSession.membership.tenantId, branchId: coreSession.branch.id });
  }, [coreSession, isAuthenticated]);

  // Authentication: the app is locked until a PIN is verified
  const [pinChangeDone, setPinChangeDone] = useState(false);
  const currentPinHash = dbState.currentUser.pinHash;
  // Expensive check (hash rounds): only recomputed when the user or his PIN changes
  const usesDefaultPin = useMemo(
    () => isAuthenticated && appRepository.currentUserHasDefaultPin(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAuthenticated, dbState.currentUser.id, currentPinHash]
  );
  const mustChangePin = usesDefaultPin && !pinChangeDone;
  const autoLogoutMinutes = dbState.settings.autoLogoutMinutes ?? 15;

  // Reset the "PIN changed" flag when the session ends
  useEffect(() => {
    if (!isAuthenticated) setPinChangeDone(false);
  }, [isAuthenticated]);

  // Auto-lock after inactivity (delay configurable in Settings, 0 = disabled)
  useEffect(() => {
    if (!isAuthenticated) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      if (autoLogoutMinutes > 0) {
        timer = setTimeout(() => { void coreSession?.signOut(); }, autoLogoutMinutes * 60_000);
      }
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [isAuthenticated, autoLogoutMinutes, coreSession]);

  // UI Navigation states
  const [currentTab, setCurrentTab] = useState<MainTab>('accueil');
  const [activeSubModule, setActiveSubModule] = useState<string | null>(null);

  // Mobile Android viewport frame toggle (default false for desktop preview, toggleable)
  const [isMobileFrame, setIsMobileFrame] = useState(false);

  // Cart state shared with POS
  const [cart, setCart] = useState<
    Array<{ product: Product; quantity: number; unitPriceUSD: number }>
  >([]);

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
const handleOpenSettings = () => {
  if (!coreSession || !['OWNER', 'ADMIN'].includes(coreSession.membership.role) || !coreSession.permissions.includes('branch.settings')) {
    return;
  }
  setIsSettingsOpen(true);
};
const [isBarcodeOpen, setIsBarcodeOpen] = useState(false);
  const [isKotlinModalOpen, setIsKotlinModalOpen] = useState(false);
  const [isApkModalOpen, setIsApkModalOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isCoreSyncCenterOpen, setIsCoreSyncCenterOpen] = useState(false);

  // Receipt Modal state
  const [receiptModalProps, setReceiptModalProps] = useState<{
    isOpen: boolean;
    sale?: Sale;
    debtRecord?: DebtRecord;
    debtRepaymentAmountUSD?: number;
    debtReceiptNumber?: string;
  }>({
    isOpen: false,
  });

  // Android Native Hardware Back Button Handler
  useEffect(() => {
    let removeListener: (() => void) | undefined;
    try {
      CapacitorApp.addListener('backButton', () => {
        if (receiptModalProps.isOpen) {
          setReceiptModalProps({ isOpen: false });
          return;
        }
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
          return;
        }
        if (isApkModalOpen) {
          setIsApkModalOpen(false);
          return;
        }
        if (isKotlinModalOpen) {
          setIsKotlinModalOpen(false);
          return;
        }
        if (isBarcodeOpen) {
          setIsBarcodeOpen(false);
          return;
        }
        if (activeSubModule) {
          setActiveSubModule(null);
          return;
        }
        if (currentTab !== 'accueil') {
          setCurrentTab('accueil');
          return;
        }
        CapacitorApp.minimizeApp().catch(() => {});
      }).then((handle) => {
        removeListener = () => handle.remove();
      });
    } catch {
      // Ignored outside native Android Capacitor container
    }

    return () => {
      if (removeListener) removeListener();
    };
  }, [
    receiptModalProps.isOpen,
    isSettingsOpen,
    isApkModalOpen,
    isKotlinModalOpen,
    isBarcodeOpen,
    activeSubModule,
    currentTab,
  ]);

  // Low stock badge count
  const lowStockCount = dbState.products.filter((p) => p.currentStock <= p.minStock).length;
  const debtAlertCount = dbState.customers.filter((c) => c.debtBalanceUSD > 0).length;
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Navigation handlers
  const handleNavigate = (tab: MainTab, subModule?: string) => {
    setCurrentTab(tab);
    if (tab === 'menu') {
      setActiveSubModule(subModule || null);
    } else {
      setActiveSubModule(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenReceiptForSale = (sale: Sale) => {
    setReceiptModalProps({
      isOpen: true,
      sale,
    });
  };

  const handleOpenDebtReceipt = (
    debtRecord: DebtRecord,
    amountUSD: number,
    debtReceiptNumber: string
  ) => {
    setReceiptModalProps({
      isOpen: true,
      debtRecord,
      debtRepaymentAmountUSD: amountUSD,
      debtReceiptNumber,
    });
  };

  // Download entire source code as ZIP archive (via direct backend endpoint or client fallback)
  const handleDownloadZip = async () => {
    if (!IS_DEV) return; // developer-only feature, never exposed in the shipped app
    try {
      // Direct HTTP download from backend server endpoint
      const link = document.createElement('a');
      link.href = '/api/download-zip';
      link.setAttribute('download', 'bta-business-transform-africa.zip');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      try {
        const blob = await generateProjectZip();
        downloadProjectZip(blob, 'bta-business-transform-africa.zip');
      } catch (err) {
        console.error('Failed to generate ZIP archive', err);
        window.open('/api/download-zip', '_blank');
      }
    }
  };

  // Barcode scanned callback: add to cart directly or open product
  const handleBarcodeScanned = (code: string) => {
    const prod = appRepository.getProductByBarcode(code);
    if (prod) {
      // Add directly to POS cart
      const existing = cart.find((i) => i.product.id === prod.id);
      if (existing) {
        setCart(
          cart.map((i) => (i.product.id === prod.id ? { ...i, quantity: i.quantity + 1 } : i))
        );
      } else {
        setCart([...cart, { product: prod, quantity: 1, unitPriceUSD: prod.sellPriceUSD }]);
      }
      handleNavigate('ventes');
    } else {
      alert(`Produit introuvable pour le code-barres / SKU : ${code}`);
    }
  };

  const hasRemotePermission = (...permissions: string[]) =>
    !cloudContext || !!remoteAccess?.permissions.some((permission) => permissions.includes(permission));
  const visibleMainTabs: MainTab[] = !cloudContext ? ['accueil', 'produits', 'ventes', 'clients', 'menu'] : [
    'accueil',
    ...(hasRemotePermission('stock.read') ? ['produits' as MainTab] : []),
    ...(hasRemotePermission('sales.read', 'sales.create') ? ['ventes' as MainTab] : []),
    ...(hasRemotePermission('customers.read', 'customers.manage', 'debts.read', 'debts.pay') ? ['clients' as MainTab] : []),
    'menu',
  ];

  // Render current content view
  const renderContent = () => {
    if (cloudContext && (!remoteAccess || remoteAccess.loading)) return <div className="p-8 text-center text-sm text-slate-600">Vérification des autorisations Core…</div>;
    if (cloudContext && !coreSession) return <div role="alert" className="m-4 p-4">Session Core indisponible.</div>;
    if (currentTab === 'produits' && !hasRemotePermission('stock.read')) return <div className="p-8 text-center text-sm text-slate-600">Accès de lecture du stock non accordé pour cet établissement.</div>;
    if (currentTab === 'ventes' && !hasRemotePermission('sales.read', 'sales.create')) return <div className="p-8 text-center text-sm text-slate-600">Accès aux ventes non accordé pour cet établissement.</div>;
    if (currentTab === 'clients' && !hasRemotePermission('customers.read', 'customers.manage', 'debts.read', 'debts.pay')) return <div className="p-8 text-center text-sm text-slate-600">Accès aux clients et dettes non accordé pour cet établissement.</div>;
    if (currentTab === 'menu' && activeSubModule) {
      const permissions: Record<string, string[]> = {
        fournisseurs: ['suppliers.read', 'suppliers.manage'], achats: ['purchases.read', 'purchases.create'],
        dettes: ['debts.read', 'debts.pay'], mouvements: ['stock.read', 'stock.manage'],
        depenses: ['expenses.read', 'expenses.create'], rapports: ['reports.read'],
        reservations: ['sales.read', 'sales.create'], dommages: ['stock.read', 'stock.manage'],
        'sorties-gratuites': ['stock.read', 'stock.manage'],
      };
      const required = permissions[activeSubModule];
      if (required && !hasRemotePermission(...required)) return <div className="p-8 text-center text-sm text-slate-600">Permission requise absente pour ce module.</div>;
    }
    if (currentTab === 'accueil') {
      return (
        <Dashboard
          products={hasRemotePermission('stock.read') ? dbState.products : []}
          customers={hasRemotePermission('customers.read', 'customers.manage') ? dbState.customers : []}
          suppliers={hasRemotePermission('suppliers.read', 'suppliers.manage') ? dbState.suppliers : []}
          sales={hasRemotePermission('sales.read') ? dbState.sales : []}
          purchases={hasRemotePermission('purchases.read') ? dbState.purchases : []}
          expenses={hasRemotePermission('expenses.read') ? dbState.expenses : []}
          debts={hasRemotePermission('debts.read') ? dbState.debts : []}
          settings={dbState.settings}
          currentUser={dbState.currentUser}
          onNavigate={(tab, sub) => handleNavigate(tab as MainTab, sub)}
          onSelectSaleForReceipt={handleOpenReceiptForSale}
        />
      );
    }

    if (currentTab === 'produits') {
      return (
        <Products
          products={dbState.products}
          categories={dbState.categories}
          stockMovements={dbState.stockMovements}
          exchangeRate={dbState.settings.exchangeRate}
          userRole={cloudContext && !hasRemotePermission('stock.manage') ? 'CASHIER' : dbState.currentUser.role}
          onSaveProduct={(data) => { guard(() => appRepository.saveProduct(data)); }}
          onDeleteProduct={(id) => { guard(() => appRepository.deleteProduct(id)); }}
          onSaveCategory={(c) => { guard(() => appRepository.updateCategory(c)); }}
          onAddCategory={(name, desc) => { guard(() => appRepository.addCategory(name, desc)); }}
          onDeleteCategory={(id) => guard(() => appRepository.deleteCategory(id)) ?? false}
          onOpenBarcodeScanner={() => setIsBarcodeOpen(true)}
        />
      );
    }

    if (currentTab === 'ventes') {
      return (
        <SalesPOS
          products={dbState.products}
          customers={dbState.customers}
          sales={hasRemotePermission('sales.read') ? dbState.sales : []}
          exchangeRate={dbState.settings.exchangeRate}
          currentUser={dbState.currentUser}
          canCreate={hasRemotePermission('sales.create')}
          onExecuteSale={(input) => appRepository.executeSale(input)}
          onOpenReceipt={handleOpenReceiptForSale}
          onOpenBarcodeScanner={() => setIsBarcodeOpen(true)}
          cart={cart}
          onUpdateCart={setCart}
        />
      );
    }

    if (currentTab === 'clients') {
      return (
        <Customers
          customers={dbState.customers}
          sales={dbState.sales}
          debts={dbState.debts}
          exchangeRate={dbState.settings.exchangeRate}
          userRole={cloudContext && !hasRemotePermission('customers.manage') ? 'CASHIER' : dbState.currentUser.role}
          onSaveCustomer={(data) => { guard(() => appRepository.saveCustomer(data)); }}
          onRecordDebtPayment={(debtId, amount, method, notes) =>
            appRepository.recordDebtRepayment(debtId, amount, method, notes)
          }
          onOpenReceiptForSale={handleOpenReceiptForSale}
          onOpenDebtReceipt={handleOpenDebtReceipt}
        />
      );
    }

    if (currentTab === 'menu') {
      // If a sub-module is active inside Menu
      if (activeSubModule) {
        return (
          <div className="space-y-4 pb-20 max-w-7xl mx-auto px-3 sm:px-4 pt-3">
            <button
              onClick={() => setActiveSubModule(null)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-xl hover:bg-slate-50 transition shadow-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour au Menu
            </button>

            {activeSubModule === 'fournisseurs' && (
              <Suppliers
                suppliers={dbState.suppliers}
                purchases={dbState.purchases}
                exchangeRate={dbState.settings.exchangeRate}
                userRole={cloudContext && !hasRemotePermission('suppliers.manage') ? 'CASHIER' : dbState.currentUser.role}
                onSaveSupplier={(data) => { guard(() => appRepository.saveSupplier(data)); }}
                onNavigateToPurchases={() => setActiveSubModule('achats')}
              />
            )}

            {activeSubModule === 'achats' && (
              <Purchases
                products={dbState.products}
                suppliers={dbState.suppliers}
                purchases={dbState.purchases}
                exchangeRate={dbState.settings.exchangeRate}
                canCreate={hasRemotePermission('purchases.create')}
                onExecutePurchase={(input) => appRepository.executePurchase(input)}
              />
            )}

            {activeSubModule === 'dettes' && (
              <Debts
                debts={hasRemotePermission('debts.read') ? dbState.debts : []}
                exchangeRate={dbState.settings.exchangeRate}
                canPay={hasRemotePermission('debts.pay')}
                onRecordDebtPayment={(debtId, amount, method, notes) =>
                  appRepository.recordDebtRepayment(debtId, amount, method, notes)
                }
                onOpenDebtReceipt={handleOpenDebtReceipt}
              />
            )}

            {activeSubModule === 'mouvements' && (
              <StockMovements
                products={dbState.products}
                stockMovements={dbState.stockMovements}
                userRole={cloudContext && !hasRemotePermission('stock.manage') ? 'CASHIER' : dbState.currentUser.role}
                onAddManualMovement={(data) => { guard(() => appRepository.recordManualMovement(data)); }}
                onReconcileInventory={(adjustments) => { guard(() => appRepository.reconcileInventory(adjustments)); }}
              />
            )}

            {activeSubModule === 'depenses' && (
              <Expenses
                expenses={dbState.expenses}
                exchangeRate={dbState.settings.exchangeRate}
                userRole={cloudContext && !hasRemotePermission('expenses.create') ? 'CASHIER' : dbState.currentUser.role}
                onAddExpense={(data) => { guard(() => appRepository.addExpense(data)); }}
              />
            )}

            {activeSubModule === 'rapports' && (
              <Reports
                products={hasRemotePermission('stock.read') ? dbState.products : []}
                sales={hasRemotePermission('sales.read') ? dbState.sales : []}
                purchases={hasRemotePermission('purchases.read') ? dbState.purchases : []}
                expenses={hasRemotePermission('expenses.read') ? dbState.expenses : []}
                debts={hasRemotePermission('debts.read') ? dbState.debts : []}
                settings={dbState.settings}
              />
            )}

            {(activeSubModule === 'reservations' || activeSubModule === 'dommages' || activeSubModule === 'sorties-gratuites') && (
              <NewOperations
                view={activeSubModule}
                reservations={dbState.reservations}
                reservationPayments={dbState.reservationPayments}
                reservationDeliveries={dbState.reservationDeliveries}
                reservationCancellations={dbState.reservationCancellations}
                stockDamages={dbState.stockDamages}
                freeIssues={dbState.freeIssues}
                products={dbState.products}
                customers={dbState.customers}
                onCreateReservation={(input) => guard(() => appRepository.createReservation(input)) || { success: false, error: 'Création interrompue.' }}
                onRecordReservationPayment={(reservationId, amount, method, notes) => guard(() => appRepository.recordReservationPayment(reservationId, amount, method, notes)) || { success: false, error: 'Paiement interrompu.' }}
                onDeliverReservation={(input) => guard(() => appRepository.deliverReservation(input)) || { success: false, error: 'Livraison interrompue.' }}
              />
            )}
          </div>
        );
      }

      // Default Menu Hub
      return (
        <MenuHub
          onSelectSubModule={(sub) => setActiveSubModule(sub)}
          currentUser={dbState.currentUser}
          settings={dbState.settings}
          syncInfo={dbState.syncInfo}
          onToggleOffline={() => appRepository.toggleNetworkMode()}
          onManualSync={() => appRepository.triggerSync()}
          onOpenSettings={handleOpenSettings}
          onOpenKotlinModal={IS_DEV ? () => setIsKotlinModalOpen(true) : undefined}
          onDownloadZip={IS_DEV ? handleDownloadZip : undefined}
          onOpenApkModal={IS_DEV ? () => setIsApkModalOpen(true) : undefined}
        />
      );
    }

    return null;
  };

  if (!isAuthenticated) return <div className="p-8">Initialisation de la session Core…</div>;

  return (
    <div className={`min-h-screen bg-slate-100 font-sans text-slate-900 ${isMobileFrame ? 'p-2 sm:p-6 flex justify-center items-center bg-slate-900/95' : ''}`}>
      {/* Container: If isMobileFrame, render inside a modern Samsung Galaxy S24 / Android Phone Mockup frame */}
      <div
        className={
          isMobileFrame
            ? 'w-full max-w-[430px] h-[92vh] bg-slate-50 rounded-[44px] shadow-2xl border-[8px] border-slate-800 overflow-hidden flex flex-col relative ring-1 ring-white/20'
            : 'w-full min-h-screen flex flex-col'
        }
      >
        {/* Android Punch Hole & Status Bar when in Mobile Frame */}
        {isMobileFrame && (
          <div className="bg-[#0B1A30] text-slate-300 text-[10px] px-6 pt-2 pb-1 flex justify-between items-center select-none shrink-0 font-medium z-40">
            <span>
              {new Date().toLocaleTimeString('fr-FR', {
                timeZone: 'Africa/Lubumbashi',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {/* Camera cutout */}
            <div className="w-3.5 h-3.5 rounded-full bg-black border border-slate-800 -mt-1 shadow-inner"></div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span>4G+</span>
              <span>100%</span>
            </div>
          </div>
        )}

        {/* Top Navbar */}
        <Navbar
          currentUser={dbState.currentUser}
          onSwitchUser={() => { void coreSession?.signOut(); }}
          users={dbState.users}
          settings={dbState.settings}
          syncInfo={dbState.syncInfo}
          onToggleOffline={() => appRepository.toggleNetworkMode()}
          onManualSync={() => appRepository.triggerSync()}
          isMobileFrame={isMobileFrame}
          onToggleMobileFrame={() => setIsMobileFrame(!isMobileFrame)}
          onOpenSettings={handleOpenSettings}
          onDownloadZip={IS_DEV ? handleDownloadZip : undefined}
          onOpenGlobalSearch={(!cloudContext || !!remoteAccess?.permissions.length) ? () => setIsGlobalSearchOpen(true) : undefined}
          onOpenSyncCenter={() => setIsCoreSyncCenterOpen(true)}
          tenantName={coreSession?.membership.name}
          activeBranch={coreSession?.branch}
          branches={coreSession?.branches}
          onSelectBranch={(branchId) => { void coreSession?.selectBranch(branchId).catch((error) => alert(error instanceof Error ? error.message : 'Changement d’établissement impossible.')); }}
        />

        <CoreSyncCenter
          isOpen={isCoreSyncCenterOpen}
          pending={appRepository.getCorePendingOperations()}
          history={dbState.coreSyncHistory}
          onClose={() => setIsCoreSyncCenterOpen(false)}
          onRetry={(id, confirmedNotApplied) => guard(() => appRepository.retryFailedCoreOperation(id, undefined, confirmedNotApplied))}
        />

        {/* Main Content Area */}
        <main className={`flex-1 ${isMobileFrame ? 'overflow-y-auto pb-16' : 'pb-20'}`}>
          {renderContent()}
        </main>

        {/* Bottom Material 3 Navigation Bar */}
        <BottomNav
          currentTab={currentTab}
          onTabChange={(tab) => handleNavigate(tab)}
          visibleTabs={visibleMainTabs}
          cartItemCount={cartItemCount}
          lowStockCount={lowStockCount}
          debtAlertCount={debtAlertCount}
        />
      </div>

      {mustChangePin && <ForcePinChange onDone={() => setPinChangeDone(true)} onLogout={() => { void coreSession?.signOut(); }} />}

      {/* Global search across all business modules */}
      <GlobalSearch
        isOpen={isGlobalSearchOpen}
        onClose={() => setIsGlobalSearchOpen(false)}
        onNavigate={({ tab, subModule }) => handleNavigate(tab, subModule)}
        products={hasRemotePermission('stock.read') ? dbState.products : []}
        customers={hasRemotePermission('customers.read', 'customers.manage') ? dbState.customers : []}
        suppliers={hasRemotePermission('suppliers.read', 'suppliers.manage') ? dbState.suppliers : []}
        sales={hasRemotePermission('sales.read') ? dbState.sales : []}
        purchases={hasRemotePermission('purchases.read') ? dbState.purchases : []}
        debts={hasRemotePermission('debts.read') ? dbState.debts : []}
        expenses={hasRemotePermission('expenses.read') ? dbState.expenses : []}
        stockMovements={hasRemotePermission('stock.read') ? dbState.stockMovements : []}
        reservations={hasRemotePermission('sales.read') ? dbState.reservations : []}
        reservationPayments={hasRemotePermission('sales.read') ? dbState.reservationPayments : []}
        reservationDeliveries={hasRemotePermission('sales.read') ? dbState.reservationDeliveries : []}
        reservationCancellations={hasRemotePermission('sales.read') ? dbState.reservationCancellations : []}
        stockDamages={dbState.stockDamages}
        freeIssues={dbState.freeIssues}
      />

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isBarcodeOpen}
        onClose={() => setIsBarcodeOpen(false)}
        onScan={handleBarcodeScanned}
        products={dbState.products}
      />

      {/* Receipt & Invoice Modal */}
      <ReceiptModal
        isOpen={receiptModalProps.isOpen}
        onClose={() => setReceiptModalProps({ isOpen: false })}
        sale={receiptModalProps.sale}
        debtRecord={receiptModalProps.debtRecord}
        debtRepaymentAmountUSD={receiptModalProps.debtRepaymentAmountUSD}
        debtReceiptNumber={receiptModalProps.debtReceiptNumber}
        settings={dbState.settings}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={dbState.settings}
        onUpdateSettings={(s) => appRepository.updateSettings(s)}
        users={dbState.users}
        onAddUser={(u, pin) => appRepository.addUser(u, pin)}
        onChangeUserPin={(id, pin) => appRepository.changeUserPin(id, pin)}
        onExportDatabase={() => {
          guard(() => {
            const json = appRepository.exportDatabaseJson();
            saveTextFile(`bta_database_backup_${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json').catch(
              () => alert('Impossible d’enregistrer la sauvegarde.')
            );
          });
        }}
        onImportDatabase={(json) => appRepository.importDatabaseJson(json)}
        onResetDatabase={() => { guard(() => appRepository.resetToDefaultSeed()); }}
        onClearDatabase={() => { guard(() => appRepository.clearAllBusinessData()); }}
        onDeleteUser={(id) => { guard(() => appRepository.deleteUser(id)); }}
        onUpdateUserProfile={(id, p) => { guard(() => appRepository.updateUserProfile(id, p)); }}
        currentUserRole={dbState.currentUser.role}
      />

      {/* Android Kotlin & Jetpack Compose Native Source Code Inspector Modal */}
      {IS_DEV && (
      <KotlinSourceModal
        isOpen={isKotlinModalOpen}
        onClose={() => setIsKotlinModalOpen(false)}
        onDownloadZip={handleDownloadZip}
      />
      )}

      {/* Android APK Export & Custom Data Setup Guide Modal */}
      {IS_DEV && (
      <ApkExportModal
        isOpen={isApkModalOpen}
        onClose={() => setIsApkModalOpen(false)}
        onDownloadZip={handleDownloadZip}
        onOpenSettings={handleOpenSettings}
      />
      )}
    </div>
  );
}

export default function App() { return <CoreSessionGate><BtaApp /></CoreSessionGate>; }
