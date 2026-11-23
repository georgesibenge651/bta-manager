import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  Download,
  Printer,
  Calendar,
  FileSpreadsheet,
  TrendingUp,
  DollarSign,
  Package,
  CreditCard,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import { Product, Sale, Purchase, Expense, DebtRecord, CompanySettings } from '../types';
import { formatUSD, formatCDF, usdToCdf, formatDateLubumbashi } from '../utils/currency';
import { csvCell, saveTextFile } from '../utils/files';

interface ReportsProps {
  products: Product[];
  sales: Sale[];
  purchases: Purchase[];
  expenses: Expense[];
  debts: DebtRecord[];
  settings: CompanySettings;
}

export const Reports: React.FC<ReportsProps> = ({
  products,
  sales,
  purchases,
  expenses,
  debts,
  settings,
}) => {
  const [period, setPeriod] = useState<'MONTH' | 'YEAR' | 'ALL'>('MONTH');
  const [reportSearch, setReportSearch] = useState('');
  const normalizedSearch = reportSearch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  // Filtered transactions by period
  const filteredSales = useMemo(() => {
    const now = new Date();
    return sales.filter((s) => {
      const d = new Date(s.date);
      const matchesPeriod = period === 'MONTH'
        ? d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
        : period === 'YEAR' ? d.getFullYear() === now.getFullYear() : true;
      const matchesSearch = !normalizedSearch || [s.invoiceNumber, s.customerName, s.cashierName, s.status, s.items.map((item) => item.productName).join(' ')].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedSearch);
      return matchesPeriod && matchesSearch;
    });
  }, [sales, period, normalizedSearch]);

  const filteredExpenses = useMemo(() => {
    const now = new Date();
    return expenses.filter((e) => {
      const d = new Date(e.date);
      const matchesPeriod = period === 'MONTH'
        ? d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
        : period === 'YEAR' ? d.getFullYear() === now.getFullYear() : true;
      const matchesSearch = !normalizedSearch || [e.title, e.description, e.category, e.receiptNumber, e.createdBy].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedSearch);
      return matchesPeriod && matchesSearch;
    });
  }, [expenses, period, normalizedSearch]);

  const filteredPurchases = useMemo(() => {
    const now = new Date();
    return purchases.filter((p) => {
      const d = new Date(p.date);
      const matchesPeriod = period === 'MONTH'
        ? d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
        : period === 'YEAR' ? d.getFullYear() === now.getFullYear() : true;
      const matchesSearch = !normalizedSearch || [p.purchaseNumber, p.supplierName, p.status, p.items.map((item) => item.productName).join(' ')].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedSearch);
      return matchesPeriod && matchesSearch;
    });
  }, [purchases, period, normalizedSearch]);

  // Financial aggregates
  const totalRevenueUSD = filteredSales.reduce((acc, s) => acc + s.totalUSD, 0);

  let cogsUSD = 0;
  filteredSales.forEach((s) => {
    s.items.forEach((item) => {
      cogsUSD += item.quantity * item.buyPriceUSD;
    });
  });

  // Real gross profit without clamping to 0 (preserves losses)
  const grossProfitUSD = totalRevenueUSD - cogsUSD;
  const totalExpensesUSD = filteredExpenses.reduce((acc, e) => acc + e.amountUSD, 0);
  const netProfitUSD = grossProfitUSD - totalExpensesUSD;
  const totalPurchasesUSD = filteredPurchases.reduce((acc, p) => acc + p.totalUSD, 0);

  const customerDebtsUSD = debts
    .filter((d) => d.type === 'CUSTOMER')
    .reduce((acc, d) => acc + d.remainingBalanceUSD, 0);

  const supplierDebtsUSD = debts
    .filter((d) => d.type === 'SUPPLIER')
    .reduce((acc, d) => acc + d.remainingBalanceUSD, 0);

  // Inventory value based strictly on acquisition cost (buyPriceUSD * currentStock)
  const stockInventoryValueUSD = products.reduce(
    (acc, p) => acc + Math.max(0, p.currentStock) * p.buyPriceUSD,
    0
  );

  // CSV Export Function
  const handleExportCSV = () => {
    const headers = ['Date', 'N_Facture', 'Client', 'Total_USD', 'Total_CDF', 'Mode_Paiement', 'Statut'];
    const rows = filteredSales.map((s) => [
      csvCell(s.date),
      csvCell(s.invoiceNumber),
      csvCell(s.customerName),
      s.totalUSD.toFixed(2),
      s.totalCDF,
      csvCell(s.paymentMethod),
      csvCell(s.status),
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    saveTextFile(`bta_rapport_ventes_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv').catch(() =>
      alert('Impossible d’enregistrer le fichier CSV.')
    );
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Header and Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-600" />
            Rapports & États Comptables
          </h3>
          <p className="text-xs text-slate-500">
            Compte d'exploitation synthétique, rentabilité et balance commerciale
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:flex-none">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Filtrer les rapports..." className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500" />
            {reportSearch && <button onClick={() => setReportSearch('')} className="absolute right-2.5 top-2.5 text-slate-400" aria-label="Effacer la recherche"><X className="w-4 h-4" /></button>}
          </div>
          {/* Period filter */}
          <div className="flex bg-slate-100 p-1 rounded-2xl text-xs font-bold">
            <button
              onClick={() => setPeriod('MONTH')}
              className={`px-3 py-1.5 rounded-xl transition ${
                period === 'MONTH' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600'
              }`}
            >
              Ce Mois
            </button>
            <button
              onClick={() => setPeriod('YEAR')}
              className={`px-3 py-1.5 rounded-xl transition ${
                period === 'YEAR' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600'
              }`}
            >
              Cette Année
            </button>
            <button
              onClick={() => setPeriod('ALL')}
              className={`px-3 py-1.5 rounded-xl transition ${
                period === 'ALL' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600'
              }`}
            >
              Tout
            </button>
          </div>

          <button
            onClick={handleExportCSV}
            className="px-3 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
            title="Exporter les ventes au format Excel CSV"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span> Excel
          </button>

          <button
            onClick={handlePrint}
            className="px-3 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
          >
            <Printer className="w-4 h-4" />
            Imprimer
          </button>
        </div>
      </div>

      {/* Financial Statement Report Sheet */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-6">
        {/* Company Header */}
        <div className="border-b border-slate-200 pb-4 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-black text-[#0F2444]">{settings.companyName}</h2>
            <p className="text-xs text-slate-500">{settings.address}, {settings.city}</p>
            <p className="text-[10px] text-slate-400">RCCM: {settings.rccm} | ID.NAT: {settings.idNat}</p>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold uppercase bg-amber-100 text-amber-800 px-3 py-1 rounded-full">
              Bilan d'Exploitation ({period})
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Généré le: {formatDateLubumbashi(new Date().toISOString())}
            </p>
          </div>
        </div>

        {/* Profit & Loss Table */}
        <div className="space-y-3">
          <h4 className="font-bold text-xs uppercase tracking-wider text-slate-600">
            Compte de Résultat d'Exploitation (P&L)
          </h4>

          <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200 text-xs">
            <div className="flex justify-between p-3 bg-slate-50 font-semibold text-slate-700">
              <span>Chiffre d'Affaires Brut (Ventes Totales)</span>
              <span className="font-bold text-slate-900">{formatUSD(totalRevenueUSD)}</span>
            </div>

            <div className="flex justify-between p-3 text-slate-600 pl-6">
              <span>- Coût d'Achat des Marchandises Vendues (COGS)</span>
              <span className="text-red-700">-{formatUSD(cogsUSD)}</span>
            </div>

            <div
              className={`flex justify-between p-3 font-bold transition ${
                grossProfitUSD >= 0
                  ? 'bg-amber-50 text-amber-900'
                  : 'bg-red-50 text-red-900 border-l-4 border-red-500'
              }`}
            >
              <span>
                = Marge Brute Commerciale{' '}
                {grossProfitUSD < 0 && (
                  <span className="text-[10px] uppercase font-black bg-red-200 text-red-900 px-1.5 py-0.5 rounded ml-1">
                    Vente à perte
                  </span>
                )}
              </span>
              <span className={`font-black text-sm ${grossProfitUSD >= 0 ? 'text-amber-950' : 'text-red-700'}`}>
                {formatUSD(grossProfitUSD)}
              </span>
            </div>

            <div className="flex justify-between p-3 text-slate-600 pl-6">
              <span>- Charges et Dépenses d'Exploitation (Carburant, Salaires, etc.)</span>
              <span className="text-purple-700">-{formatUSD(totalExpensesUSD)}</span>
            </div>

            <div
              className={`flex justify-between p-3.5 font-black text-sm transition ${
                netProfitUSD >= 0
                  ? 'bg-emerald-50 text-emerald-900'
                  : 'bg-red-100 text-red-950 border-l-4 border-red-600'
              }`}
            >
              <span>
                = RÉSULTAT NET DE L'EXPLOITATION{' '}
                {netProfitUSD < 0 && (
                  <span className="text-[10px] uppercase font-black bg-red-300 text-red-950 px-1.5 py-0.5 rounded ml-1">
                    Déficit net
                  </span>
                )}
              </span>
              <span className={`text-base ${netProfitUSD >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                {formatUSD(netProfitUSD)}
              </span>
            </div>
          </div>
        </div>

        {/* Balance of Assets & Liabilities */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
            <span className="text-xs text-slate-500 font-semibold">
              Valeur Comptable du Stock (Coût PAMP)
            </span>
            <p className="text-lg font-black text-[#0F2444]">{formatUSD(stockInventoryValueUSD)}</p>
            <p className="text-[10px] text-amber-700">{formatCDF(usdToCdf(stockInventoryValueUSD, settings.exchangeRate))}</p>
          </div>

          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 space-y-1">
            <span className="text-xs text-amber-800 font-semibold">Créances Clients Dehors</span>
            <p className="text-lg font-black text-amber-900">{formatUSD(customerDebtsUSD)}</p>
            <p className="text-[10px] text-amber-700">{formatCDF(usdToCdf(customerDebtsUSD, settings.exchangeRate))}</p>
          </div>

          <div className="p-4 bg-red-50 rounded-2xl border border-red-200 space-y-1">
            <span className="text-xs text-red-800 font-semibold">Dettes Fournisseurs Dues</span>
            <p className="text-lg font-black text-red-900">{formatUSD(supplierDebtsUSD)}</p>
            <p className="text-[10px] text-red-700">{formatCDF(usdToCdf(supplierDebtsUSD, settings.exchangeRate))}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
