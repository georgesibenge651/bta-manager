import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  Package,
  Users,
  Building,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  PlusCircle,
  ShoppingCart,
  Receipt,
  Truck,
  CreditCard,
  PieChart as PieIcon,
  Filter,
} from 'lucide-react';
import {
  Product,
  Customer,
  Supplier,
  Sale,
  Purchase,
  Expense,
  DebtRecord,
  CompanySettings,
  User,
} from '../types';
import { formatUSD, formatCDF, usdToCdf, formatDateLubumbashi } from '../utils/currency';

interface DashboardProps {
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  purchases: Purchase[];
  expenses: Expense[];
  debts: DebtRecord[];
  settings: CompanySettings;
  currentUser: User;
  onNavigate: (tab: 'accueil' | 'produits' | 'ventes' | 'clients' | 'menu', subModule?: string) => void;
  onSelectSaleForReceipt: (sale: Sale) => void;
}

type PeriodFilter = 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';

export const Dashboard: React.FC<DashboardProps> = ({
  products,
  customers,
  suppliers,
  sales,
  expenses,
  debts,
  settings,
  currentUser,
  onNavigate,
  onSelectSaleForReceipt,
}) => {
  const [period, setPeriod] = useState<PeriodFilter>('MONTH');

  // Filter sales and expenses based on selected period
  const filteredSales = useMemo(() => {
    const now = new Date();
    return sales.filter((s) => {
      const saleDate = new Date(s.date);
      if (period === 'TODAY') {
        return saleDate.toDateString() === now.toDateString();
      }
      if (period === 'WEEK') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return saleDate >= weekAgo;
      }
      if (period === 'MONTH') {
        return saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear();
      }
      if (period === 'YEAR') {
        return saleDate.getFullYear() === now.getFullYear();
      }
      return true;
    });
  }, [sales, period]);

  const filteredExpenses = useMemo(() => {
    const now = new Date();
    return expenses.filter((e) => {
      const expDate = new Date(e.date);
      if (period === 'TODAY') {
        return expDate.toDateString() === now.toDateString();
      }
      if (period === 'WEEK') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return expDate >= weekAgo;
      }
      if (period === 'MONTH') {
        return expDate.getMonth() === now.getMonth() && expDate.getFullYear() === now.getFullYear();
      }
      if (period === 'YEAR') {
        return expDate.getFullYear() === now.getFullYear();
      }
      return true;
    });
  }, [expenses, period]);

  // Aggregate Key Figures
  const stats = useMemo(() => {
    const totalProducts = products.length;
    const totalCustomers = customers.length;
    const totalSuppliers = suppliers.length;

    // Stock value (USD)
    const stockValueBuyUSD = products.reduce((acc, p) => acc + p.currentStock * p.buyPriceUSD, 0);
    const stockValueSellUSD = products.reduce((acc, p) => acc + p.currentStock * p.sellPriceUSD, 0);

    // Sales totals
    const todaySalesUSD = sales
      .filter((s) => new Date(s.date).toDateString() === new Date().toDateString())
      .reduce((acc, s) => acc + s.totalUSD, 0);

    const periodSalesUSD = filteredSales.reduce((acc, s) => acc + s.totalUSD, 0);

    // Cost of goods sold for filtered sales
    let cogsUSD = 0;
    filteredSales.forEach((sale) => {
      sale.items.forEach((item) => {
        cogsUSD += item.quantity * item.buyPriceUSD;
      });
    });

    const grossProfitUSD = periodSalesUSD - cogsUSD; // losses are kept (same rule as Reports)
    const periodExpensesUSD = filteredExpenses.reduce((acc, e) => acc + e.amountUSD, 0);
    const netProfitUSD = grossProfitUSD - periodExpensesUSD;

    // Debts
    const customerDebtsUSD = customers.reduce((acc, c) => acc + (c.debtBalanceUSD || 0), 0);
    const supplierDebtsUSD = suppliers.reduce((acc, s) => acc + (s.balanceDueUSD || 0), 0);

    // Stock alerts
    const outOfStockProducts = products.filter((p) => p.currentStock <= 0);
    const lowStockProducts = products.filter((p) => p.currentStock > 0 && p.currentStock <= p.minStock);

    return {
      totalProducts,
      totalCustomers,
      totalSuppliers,
      stockValueBuyUSD,
      stockValueSellUSD,
      todaySalesUSD,
      periodSalesUSD,
      grossProfitUSD,
      periodExpensesUSD,
      netProfitUSD,
      customerDebtsUSD,
      supplierDebtsUSD,
      outOfStockProducts,
      lowStockProducts,
    };
  }, [products, customers, suppliers, sales, filteredSales, filteredExpenses]);

  // Top Selling Products Calculation
  const topSellingProducts = useMemo(() => {
    const productSalesMap = new Map<string, { name: string; quantity: number; revenue: number; unit: string }>();

    filteredSales.forEach((sale) => {
      sale.items.forEach((item) => {
        const curr = productSalesMap.get(item.productId) || {
          name: item.productName,
          quantity: 0,
          revenue: 0,
          unit: item.unit,
        };
        curr.quantity += item.quantity;
        curr.revenue += item.totalUSD;
        productSalesMap.set(item.productId, curr);
      });
    });

    return Array.from(productSalesMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 4);
  }, [filteredSales]);

  // Daily Chart Points (Last 7 days)
  const salesChartData = useMemo(() => {
    const days: { label: string; amountUSD: number }[] = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStr = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
      const dayTotal = sales
        .filter((s) => new Date(s.date).toDateString() === d.toDateString())
        .reduce((sum, s) => sum + s.totalUSD, 0);
      days.push({ label: dayStr, amountUSD: dayTotal });
    }
    return days;
  }, [sales]);

  const maxChartVal = Math.max(...salesChartData.map((d) => d.amountUSD), 100);

  // Expense Categories Breakdown
  const expensesByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    filteredExpenses.forEach((e) => {
      map[e.category] = (map[e.category] || 0) + e.amountUSD;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredExpenses]);

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto px-3 sm:px-4 pt-3">
      {/* Welcome Banner & Period Filter */}
      <div className="bg-gradient-to-r from-[#0F2444] via-[#16365E] to-[#1E4D82] rounded-3xl p-4 sm:p-5 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-semibold text-sky-300">
                Tableau de Bord Exécutif
              </span>
              <span className="bg-sky-400/20 text-sky-200 text-[10px] px-2 py-0.5 rounded-full font-bold">
                1$ = {settings.exchangeRate} FC
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black mt-1 text-white tracking-tight">
              Bonjour, {currentUser.name}
            </h1>
            <p className="text-xs text-slate-300 mt-0.5">
              Gestion commerciale et financière • {settings.city}
            </p>
          </div>

          {/* Period Filter Buttons */}
          <div className="flex items-center gap-1 bg-white/10 p-1 rounded-2xl backdrop-blur-md self-start md:self-center overflow-x-auto max-w-full text-xs">
            <Filter className="w-3.5 h-3.5 text-sky-300 ml-1.5 shrink-0 hidden sm:inline" />
            <button
              onClick={() => setPeriod('TODAY')}
              className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                period === 'TODAY' ? 'bg-sky-500 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              Aujourd'hui
            </button>
            <button
              onClick={() => setPeriod('WEEK')}
              className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                period === 'WEEK' ? 'bg-sky-500 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              Semaine
            </button>
            <button
              onClick={() => setPeriod('MONTH')}
              className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                period === 'MONTH' ? 'bg-sky-500 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              Ce Mois
            </button>
            <button
              onClick={() => setPeriod('YEAR')}
              className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                period === 'YEAR' ? 'bg-sky-500 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              Année
            </button>
            <button
              onClick={() => setPeriod('ALL')}
              className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                period === 'ALL' ? 'bg-sky-500 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              Tout
            </button>
          </div>
        </div>

        {/* Ambient background blur accents */}
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>
      </div>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          onClick={() => onNavigate('ventes')}
          className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-sky-600 to-blue-700 text-white shadow-md hover:shadow-lg hover:scale-[1.01] transition-all"
        >
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <ShoppingCart className="w-5 h-5" />
          </div>
          <div className="text-left">
            <p className="text-xs text-sky-100 font-medium">Point de Vente</p>
            <p className="text-sm font-bold leading-tight">Nouvelle Vente</p>
          </div>
        </button>

        <button
          onClick={() => onNavigate('produits')}
          className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-slate-200 text-slate-800 shadow-sm hover:border-sky-300 hover:shadow transition"
        >
          <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <PlusCircle className="w-5 h-5" />
          </div>
          <div className="text-left">
            <p className="text-xs text-slate-500 font-medium">Catalogue</p>
            <p className="text-sm font-bold text-slate-900 leading-tight">Ajouter Produit</p>
          </div>
        </button>

        <button
          onClick={() => onNavigate('menu', 'achats')}
          className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-slate-200 text-slate-800 shadow-sm hover:border-emerald-300 hover:shadow transition"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5" />
          </div>
          <div className="text-left">
            <p className="text-xs text-slate-500 font-medium">Fournisseurs</p>
            <p className="text-sm font-bold text-slate-900 leading-tight">Approvisionner</p>
          </div>
        </button>

        <button
          onClick={() => onNavigate('menu', 'depenses')}
          className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-slate-200 text-slate-800 shadow-sm hover:border-purple-300 hover:shadow transition"
        >
          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Receipt className="w-5 h-5" />
          </div>
          <div className="text-left">
            <p className="text-xs text-slate-500 font-medium">Comptabilité</p>
            <p className="text-sm font-bold text-slate-900 leading-tight">Dépense Caisse</p>
          </div>
        </button>
      </div>

      {/* Stock Alerts Warnings (if any) */}
      {(stats.outOfStockProducts.length > 0 || stats.lowStockProducts.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {stats.outOfStockProducts.length > 0 && (
            <div
              onClick={() => onNavigate('produits')}
              className="bg-red-50 border border-red-200 rounded-2xl p-3 flex items-center justify-between cursor-pointer hover:bg-red-100/70 transition"
            >
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-red-900">
                    {stats.outOfStockProducts.length} produit(s) en rupture totale !
                  </p>
                  <p className="text-[11px] text-red-700 truncate max-w-xs">
                    {stats.outOfStockProducts.map((p) => p.name).join(', ')}
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-red-700 underline shrink-0">Voir</span>
            </div>
          )}

          {stats.lowStockProducts.length > 0 && (
            <div
              onClick={() => onNavigate('produits')}
              className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center justify-between cursor-pointer hover:bg-amber-100/70 transition"
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-amber-900">
                    {stats.lowStockProducts.length} produit(s) proche(s) du seuil minimal
                  </p>
                  <p className="text-[11px] text-amber-700 truncate max-w-xs">
                    {stats.lowStockProducts.map((p) => p.name).join(', ')}
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-amber-700 underline shrink-0">Réapprovisionner</span>
            </div>
          )}
        </div>
      )}

      {/* Financial Core Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Sales Card */}
        <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm relative overflow-hidden group hover:border-sky-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">
              Ventes ({period === 'TODAY' ? "Aujourd'hui" : period === 'MONTH' ? 'Ce Mois' : 'Période'})
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900 mt-2">
            {formatUSD(stats.periodSalesUSD)}
          </p>
          <p className="text-xs font-bold text-sky-700 mt-0.5">
            {formatCDF(usdToCdf(stats.periodSalesUSD, settings.exchangeRate))}
          </p>
          <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3 text-emerald-500" />
            <span>Aujourd'hui: {formatUSD(stats.todaySalesUSD)}</span>
          </div>
        </div>

        {/* Estimated Profit Card */}
        <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm relative overflow-hidden group hover:border-emerald-300 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Bénéfice Net Estimé</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-black text-emerald-700 mt-2">
            {formatUSD(stats.netProfitUSD)}
          </p>
          <p className="text-xs font-bold text-emerald-600 mt-0.5">
            {formatCDF(usdToCdf(stats.netProfitUSD, settings.exchangeRate))}
          </p>
          <div className="mt-2 text-[10px] text-slate-400">
            Brut: {formatUSD(stats.grossProfitUSD)} - Dépenses
          </div>
        </div>

        {/* Stock Value Card */}
        <div
          onClick={() => onNavigate('produits')}
          className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm relative overflow-hidden group hover:border-blue-300 transition cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Valeur Marchande Stock</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900 mt-2">
            {formatUSD(stats.stockValueSellUSD)}
          </p>
          <p className="text-xs font-bold text-blue-700 mt-0.5">
            Coût d'achat: {formatUSD(stats.stockValueBuyUSD)}
          </p>
          <div className="mt-2 text-[10px] text-slate-400">
            {stats.totalProducts} références en catalogue
          </div>
        </div>

        {/* Debts Exposure Card */}
        <div
          onClick={() => onNavigate('menu', 'dettes')}
          className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm relative overflow-hidden group hover:border-amber-300 transition cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Dettes & Créances</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-black text-amber-700 mt-2">
            {formatUSD(stats.customerDebtsUSD)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Créances dues par clients</p>
          <div className="mt-2 text-[10px] text-slate-400">
            Dettes Fournisseurs: <span className="font-bold text-slate-700">{formatUSD(stats.supplierDebtsUSD)}</span>
          </div>
        </div>
      </div>

      {/* Interactive Sales Chart & Top Selling Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Sales Evolution Chart (7 Days SVG) */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-sm text-slate-800">Évolution des Ventes (7 derniers jours)</h3>
              <p className="text-xs text-slate-400">Activité journalière en magasin</p>
            </div>
            <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-xl">
              USD & CDF
            </span>
          </div>

          {/* Bar Chart Visualization */}
          <div className="h-44 flex items-end justify-between gap-2 pt-6 pb-2 px-2 border-b border-slate-100">
            {salesChartData.map((d, index) => {
              const heightPercent = Math.max(8, Math.round((d.amountUSD / maxChartVal) * 100));
              return (
                <div key={index} className="flex-1 flex flex-col items-center gap-1 group relative">
                  {/* Tooltip on hover */}
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] rounded-lg py-1 px-2 whitespace-nowrap shadow-lg pointer-events-none z-10 font-mono">
                    {formatUSD(d.amountUSD)} ({formatCDF(usdToCdf(d.amountUSD, settings.exchangeRate))})
                  </div>

                  <div className="w-full max-w-[36px] bg-slate-100 rounded-t-xl h-36 flex items-end overflow-hidden">
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className="w-full bg-gradient-to-t from-sky-600 to-sky-400 rounded-t-xl transition-all duration-500 group-hover:from-sky-500 group-hover:to-sky-300"
                    ></div>
                  </div>
                  <span className="text-[10px] font-medium text-slate-500 truncate w-full text-center">
                    {d.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-3">
            <span>Moyenne journalière estimée</span>
            <span className="font-bold text-slate-800">
              {formatUSD(stats.periodSalesUSD / (period === 'WEEK' ? 7 : 30))} / jour
            </span>
          </div>
        </div>

        {/* Top Selling Products List */}
        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-slate-800">Produits les plus vendus</h3>
              <Package className="w-4 h-4 text-slate-400" />
            </div>

            <div className="space-y-3">
              {topSellingProducts.length > 0 ? (
                topSellingProducts.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-5 h-5 rounded-lg bg-sky-100 text-sky-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="truncate">
                        <p className="font-semibold text-slate-800 truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {p.quantity} {p.unit} vendus
                        </p>
                      </div>
                    </div>
                    <span className="font-bold text-slate-900 shrink-0">{formatUSD(p.revenue)}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 italic py-4 text-center">
                  Aucune vente enregistrée sur cette période
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => onNavigate('produits')}
            className="w-full mt-4 py-2 text-xs font-semibold text-sky-600 bg-sky-50 hover:bg-sky-100 rounded-xl transition text-center"
          >
            Consulter tout le stock ({products.length})
          </button>
        </div>
      </div>

      {/* Recent Sales Table & Expenses Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Recent Transactions List */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-800">Dernières Factures Émises</h3>
              <p className="text-xs text-slate-400">Cliquez pour imprimer ou envoyer sur WhatsApp</p>
            </div>
            <button
              onClick={() => onNavigate('ventes')}
              className="text-xs font-bold text-sky-600 hover:text-sky-700"
            >
              Historique complet
            </button>
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto">
            {sales.slice(0, 5).map((sale) => (
              <div
                key={sale.id}
                onClick={() => onSelectSaleForReceipt(sale)}
                className="py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 px-2 rounded-xl transition cursor-pointer"
              >
                <div className="truncate">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-800">{sale.invoiceNumber}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-medium">
                      {sale.items.length} art.
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    {sale.customerName} • {formatDateLubumbashi(sale.date)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-slate-900">{formatUSD(sale.totalUSD)}</p>
                  <p className="text-[10px] text-sky-700">{formatCDF(sale.totalCDF)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expenses Breakdown Mini Box */}
        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-slate-800">Dépenses par catégorie</h3>
              <PieIcon className="w-4 h-4 text-slate-400" />
            </div>

            <div className="space-y-2">
              {expensesByCategory.map(([cat, amount], idx) => {
                const totalExp = stats.periodExpensesUSD || 1;
                const pct = Math.round((amount / totalExp) * 100);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-600 font-medium">{cat}</span>
                      <span className="font-bold text-slate-800">{formatUSD(amount)} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        style={{ width: `${pct}%` }}
                        className="bg-purple-600 h-full rounded-full"
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Total dépenses ({period})</span>
            <span className="font-bold text-purple-700">{formatUSD(stats.periodExpensesUSD)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
