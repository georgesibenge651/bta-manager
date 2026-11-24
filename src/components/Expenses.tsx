import React, { useState } from 'react';
import { Receipt, Plus, Filter, Calendar, X, DollarSign, Search } from 'lucide-react';
import { Expense, ExpenseCategory, UserRole } from '../types';
import { formatUSD, formatCDF, usdToCdf, formatDateLubumbashi } from '../utils/currency';
import { useLanguage } from '../i18n';

interface ExpensesProps {
  expenses: Expense[];
  exchangeRate: number;
  userRole: UserRole;
  onAddExpense: (data: {
    title: string;
    description: string;
    category: ExpenseCategory;
    amountUSD: number;
    exchangeRate?: number;
    receiptNumber?: string;
  }) => void;
}

export const Expenses: React.FC<ExpensesProps> = ({
  expenses,
  exchangeRate,
  userRole,
  onAddExpense,
}) => {
  const { language, t } = useLanguage();
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('TRANSPORT');
  const [amountUSD, setAmountUSD] = useState<number>(0);

  const canAdd = userRole === 'ADMIN' || userRole === 'GESTIONNAIRE';

  const normalizedSearch = searchTerm.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const filteredExpenses = expenses.filter((e) => {
    const matchesCategory = selectedCategory === 'ALL' || e.category === selectedCategory;
    const matchesSearch = !normalizedSearch || [e.title, e.description, e.category, e.receiptNumber, e.createdBy, e.date, e.amountUSD].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  });

  const totalExpensesUSD = filteredExpenses.reduce((sum, e) => sum + e.amountUSD, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || amountUSD <= 0) return;

    onAddExpense({
      title: title.trim(),
      description: description.trim(),
      category,
      amountUSD,
      exchangeRate,
    });

    setIsModalOpen(false);
    setTitle('');
    setDescription('');
    setAmountUSD(0);
  };

  const getCategoryBadge = (cat: ExpenseCategory) => {
    switch (cat) {
      case 'TRANSPORT':
        return 'bg-amber-100 text-amber-800';
      case 'RENT':
        return 'bg-amber-100 text-amber-800';
      case 'SALARY':
        return 'bg-emerald-100 text-emerald-800';
      case 'ELECTRICITY':
        return 'bg-yellow-100 text-yellow-800';
      case 'INTERNET':
        return 'bg-purple-100 text-purple-800';
      case 'MAINTENANCE':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };
  const getCategoryLabel = (cat: ExpenseCategory) => ({
    TRANSPORT: t('Transport', 'Transport'),
    RENT: t('Loyer', 'Rent'),
    SALARY: t('Salaires', 'Salaries'),
    ELECTRICITY: t('Électricité / Carburant', 'Electricity / Fuel'),
    INTERNET: t('Internet', 'Internet'),
    MAINTENANCE: t('Entretien', 'Maintenance'),
    OTHER: t('Autres', 'Other'),
  }[cat]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-purple-600" />
            {t('Gestion des Dépenses & Frais Généraux', 'Expenses & Overhead Management')}
          </h3>
          <p className="text-xs text-slate-500">
            {t("Enregistrement des sorties de caisse quotidiennes et charges d'exploitation", 'Record daily cash outflows and operating expenses')}
          </p>
        </div>

        {canAdd && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            {t('Nouvelle Dépense', 'New Expense')}
          </button>
        )}
      </div>

      {/* Summary KPI Banner */}
      <div className="bg-gradient-to-r from-purple-900 to-[#0F2444] rounded-3xl p-4 sm:p-5 text-white flex justify-between items-center shadow-md">
        <div>
          <span className="text-xs text-purple-200 font-semibold uppercase">{t('Total Dépenses Enregistrées', 'Total Recorded Expenses')}</span>
          <p className="text-2xl font-black text-white mt-1">{formatUSD(totalExpensesUSD)}</p>
          <p className="text-xs text-purple-200 font-bold">
            {formatCDF(usdToCdf(totalExpensesUSD, exchangeRate))}
          </p>
        </div>
        <div className="text-right text-xs text-slate-300">
          <p className="font-bold text-white">{filteredExpenses.length} {t('pièces justificatives', 'receipts')}</p>
          <p className="text-[10px] text-slate-400">1$ = {exchangeRate} FC</p>
        </div>
      </div>

      {/* Categories Filter Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
        {['ALL', 'TRANSPORT', 'RENT', 'SALARY', 'ELECTRICITY', 'INTERNET', 'MAINTENANCE', 'OTHER'].map(
          (cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 ${
                selectedCategory === cat
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {cat === 'ALL'
                ? t('Toutes', 'All')
                : getCategoryLabel(cat as ExpenseCategory)}
            </button>
          )
        )}
      </div>

      {/* Search */}
      <div className="relative bg-white rounded-2xl border border-slate-200 p-3">
        <Search className="w-4 h-4 absolute left-6 top-5 text-slate-400" />
        <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t('Rechercher par libellé, reçu, catégorie, agent ou montant...', 'Search by description, receipt, category, user, or amount...')} className="w-full pl-8 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500" />
        {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-6 top-5 text-slate-400" aria-label={t('Effacer la recherche', 'Clear search')}><X className="w-4 h-4" /></button>}
      </div>

      {/* Expenses List */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm space-y-2">
        <div className="divide-y divide-slate-100">
          {filteredExpenses.map((expense) => (
            <div
              key={expense.id}
              className="py-3 px-2 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 rounded-xl"
            >
              <div className="truncate flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getCategoryBadge(expense.category)}`}>
                    {getCategoryLabel(expense.category)}
                  </span>
                  <span className="font-bold text-slate-800 text-xs truncate">{expense.title}</span>
                </div>
                {expense.description && (
                  <p className="text-[11px] text-slate-500 mt-1 truncate">{expense.description}</p>
                )}
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {t('Reçu', 'Receipt')}: {expense.receiptNumber} • {t('Par', 'By')} {expense.createdBy} • {formatDateLubumbashi(expense.date, true, language === 'en' ? 'en-US' : 'fr-FR')}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-black text-slate-900">{formatUSD(expense.amountUSD)}</p>
                <p className="text-[10px] text-purple-700 font-bold">{formatCDF(expense.amountCDF)}</p>
              </div>
            </div>
          ))}
          {filteredExpenses.length === 0 && <p className="py-8 text-center text-xs text-slate-400">{t('Aucune dépense correspondante.', 'No matching expenses.')}</p>}
        </div>
      </div>

      {/* Add Expense Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-base">{t('Enregistrer une Dépense Caisse', 'Record a Cash Expense')}</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">{t('Catégorie de Charge *', 'Expense Category *')}</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                >
                  <option value="ELECTRICITY">{t('Électricité & Carburant Groupe Électrogène', 'Electricity & Generator Fuel')}</option>
                  <option value="TRANSPORT">{t('Transport & Logistique Livraisons', 'Transport & Delivery Logistics')}</option>
                  <option value="RENT">{t('Loyer Magasin ou Dépôt', 'Shop or Warehouse Rent')}</option>
                  <option value="SALARY">{t('Salaires & Primes Personnel', 'Staff Salaries & Bonuses')}</option>
                  <option value="INTERNET">{t('Internet, Téléphonie & Communication', 'Internet, Phone & Communications')}</option>
                  <option value="MAINTENANCE">{t('Entretien, Réparations & Fournitures Bureau', 'Maintenance, Repairs & Office Supplies')}</option>
                  <option value="OTHER">{t('Autres Dépenses Diverses', 'Other Expenses')}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">{t('Intitulé de la dépense *', 'Expense Title *')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('Ex: Gasoil groupe électrogène (50L)...', 'e.g., Generator diesel (50 L)...')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">{t('Montant Décaissé (USD) *', 'Amount Spent (USD) *')}</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  required
                  value={amountUSD || ''}
                  onChange={(e) => setAmountUSD(parseFloat(e.target.value) || 0)}
                  className="w-full text-base font-black p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 font-mono"
                />
                <p className="text-[11px] text-purple-700 font-bold mt-1">
                  {t('Équiv', 'Equivalent')}: {formatCDF(usdToCdf(amountUSD, exchangeRate))} ({t('Taux', 'Rate')}: {exchangeRate})
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">{t('Détails / Justificatif', 'Details / Receipt')}</label>
                <textarea
                  rows={2}
                  placeholder={t('Ex: Facture station-service n° 48102, délestage SNEL de 8h à 18h...', 'e.g., Gas station receipt #48102, SNEL outage from 8 a.m. to 6 p.m....')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  {t('Annuler', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-md"
                >
                  {t('Valider la Dépense', 'Save Expense')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
