import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Edit2,
  Receipt,
  FileText,
  AlertTriangle,
  CheckCircle,
  X,
  History,
  DollarSign,
} from 'lucide-react';
import { Customer, Sale, DebtRecord, PaymentMethod, UserRole } from '../types';
import { formatUSD, formatCDF, formatDateLubumbashi } from '../utils/currency';

interface CustomersProps {
  customers: Customer[];
  sales: Sale[];
  debts: DebtRecord[];
  exchangeRate: number;
  userRole: UserRole;
  onSaveCustomer: (customerData: Omit<Customer, 'id' | 'registeredAt'> & { id?: string }) => void;
  onRecordDebtPayment: (
    debtId: string,
    amountUSD: number,
    method: PaymentMethod,
    notes?: string
  ) => { success: boolean; error?: string; updatedDebt?: DebtRecord; receiptNumber?: string };
  onOpenReceiptForSale: (sale: Sale) => void;
  onOpenDebtReceipt: (debt: DebtRecord, amountUSD: number, receiptNum: string) => void;
}

export const Customers: React.FC<CustomersProps> = ({
  customers,
  sales,
  debts,
  exchangeRate,
  userRole,
  onSaveCustomer,
  onRecordDebtPayment,
  onOpenReceiptForSale,
  onOpenDebtReceipt,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debtFilter, setDebtFilter] = useState<'ALL' | 'WITH_DEBT' | 'CLEAR'>('ALL');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Repayment modal state
  const [isRepaymentModalOpen, setIsRepaymentModalOpen] = useState(false);
  const [repaymentDebtRecord, setRepaymentDebtRecord] = useState<DebtRecord | null>(null);
  const [repaymentAmountUSD, setRepaymentAmountUSD] = useState<number>(0);
  const [repaymentMethod, setRepaymentMethod] = useState<PaymentMethod>('CASH');
  const [repaymentNotes, setRepaymentNotes] = useState('');
  const [repaymentError, setRepaymentError] = useState('');

  // Customer Form state
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    email: '',
    city: 'Lubumbashi',
    creditLimitUSD: 1000,
    debtBalanceUSD: 0,
    notes: '',
  });

  const canEdit =
    userRole === 'ADMIN' ||
    userRole === 'ADMINISTRATEUR' ||
    userRole === 'GESTIONNAIRE' ||
    userRole === 'MANAGER';

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchSearch =
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone.includes(searchTerm) ||
        c.city.toLowerCase().includes(searchTerm.toLowerCase());

      let matchDebt = true;
      if (debtFilter === 'WITH_DEBT') {
        matchDebt = c.debtBalanceUSD > 0;
      } else if (debtFilter === 'CLEAR') {
        matchDebt = c.debtBalanceUSD <= 0;
      }

      return matchSearch && matchDebt;
    });
  }, [customers, searchTerm, debtFilter]);

  const handleOpenAdd = () => {
    setEditingCustomer(null);
    setFormData({
      name: '',
      phone: '+243 ',
      address: '',
      email: '',
      city: 'Lubumbashi',
      creditLimitUSD: 1000,
      debtBalanceUSD: 0,
      notes: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditingCustomer(c);
    setFormData({
      name: c.name,
      phone: c.phone,
      address: c.address,
      email: c.email,
      city: c.city,
      creditLimitUSD: c.creditLimitUSD,
      debtBalanceUSD: c.debtBalanceUSD,
      notes: c.notes || '',
    });
    setIsModalOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    onSaveCustomer({
      id: editingCustomer?.id,
      name: formData.name,
      phone: formData.phone,
      address: formData.address,
      email: formData.email,
      city: formData.city,
      creditLimitUSD: Number(formData.creditLimitUSD) || 0,
      debtBalanceUSD: editingCustomer ? editingCustomer.debtBalanceUSD : Number(formData.debtBalanceUSD) || 0,
      notes: formData.notes,
    });

    setIsModalOpen(false);
  };

  // Open repayment modal
  const handleOpenRepayment = (debt: DebtRecord) => {
    setRepaymentDebtRecord(debt);
    setRepaymentAmountUSD(debt.remainingBalanceUSD);
    setRepaymentMethod('CASH');
    setRepaymentNotes('');
    setRepaymentError('');
    setIsRepaymentModalOpen(true);
  };

  const handleExecuteRepayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repaymentDebtRecord) return;
    setRepaymentError('');

    const res = onRecordDebtPayment(
      repaymentDebtRecord.id,
      repaymentAmountUSD,
      repaymentMethod,
      repaymentNotes.trim() || undefined
    );

    if (!res.success) {
      setRepaymentError(res.error || 'Erreur lors du versement');
      return;
    }

    setIsRepaymentModalOpen(false);
    if (res.updatedDebt && res.receiptNumber) {
      onOpenDebtReceipt(res.updatedDebt, repaymentAmountUSD, res.receiptNumber);
    }
  };

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto px-3 sm:px-4 pt-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-sky-600" />
            Gestion des Clients & Créances
          </h2>
          <p className="text-xs text-slate-500">
            {customers.length} clients répertoriés • Suivi des dettes et limites de crédit
          </p>
        </div>

        {canEdit && (
          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md self-start sm:self-auto transition"
          >
            <Plus className="w-4 h-4" />
            Nouveau Client
          </button>
        )}
      </div>

      {/* Search & Debt Filter */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher client par nom, téléphone, ville..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-none"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl text-xs">
          <button
            onClick={() => setDebtFilter('ALL')}
            className={`px-3 py-1 rounded-lg font-medium transition ${
              debtFilter === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Tous ({customers.length})
          </button>
          <button
            onClick={() => setDebtFilter('WITH_DEBT')}
            className={`px-3 py-1 rounded-lg font-medium transition ${
              debtFilter === 'WITH_DEBT' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600'
            }`}
          >
            Endettés ({customers.filter((c) => c.debtBalanceUSD > 0).length})
          </button>
          <button
            onClick={() => setDebtFilter('CLEAR')}
            className={`px-3 py-1 rounded-lg font-medium transition ${
              debtFilter === 'CLEAR' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'
            }`}
          >
            À Jour
          </button>
        </div>
      </div>

      {/* Customers List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredCustomers.map((customer) => {
          const hasDebt = customer.debtBalanceUSD > 0;
          const customerSales = sales.filter((s) => s.customerId === customer.id);
          const customerDebts = debts.filter((d) => d.partyId === customer.id && d.type === 'CUSTOMER');

          return (
            <div
              key={customer.id}
              className="bg-white rounded-3xl border border-slate-200 shadow-xs hover:shadow-md transition p-4 space-y-3 flex flex-col justify-between group"
            >
              <div className="space-y-2.5">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0F2444] to-sky-600 text-white flex items-center justify-center font-bold text-sm shadow-sm shrink-0">
                      {customer.name.charAt(0)}
                    </div>
                    <div className="truncate">
                      <h3 className="font-bold text-sm text-slate-900 truncate" title={customer.name}>
                        {customer.name}
                      </h3>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {customer.city}
                      </p>
                    </div>
                  </div>

                  {canEdit && (
                    <button
                      onClick={() => handleOpenEdit(customer)}
                      className="p-1.5 text-slate-400 hover:text-sky-600 rounded-lg hover:bg-sky-50"
                      title="Modifier coordonnées"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Contact details */}
                <div className="space-y-1 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-2xl border border-slate-100">
                  <p className="flex items-center gap-1.5 font-medium">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {customer.phone || 'Non renseigné'}
                  </p>
                  {customer.email && (
                    <p className="flex items-center gap-1.5 truncate text-[11px] text-slate-500">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      {customer.email}
                    </p>
                  )}
                  {customer.address && (
                    <p className="text-[11px] text-slate-400 truncate">{customer.address}</p>
                  )}
                </div>

                {/* Financial Debt Status Box */}
                <div
                  className={`p-3 rounded-2xl border ${
                    hasDebt
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold">Solde Dette :</span>
                    <span className="font-black text-sm">
                      {hasDebt ? formatUSD(customer.debtBalanceUSD) : '0.00 $ (À jour)'}
                    </span>
                  </div>
                  {hasDebt && (
                    <p className="text-[10px] text-amber-700 font-bold mt-0.5">
                      Équiv. CDF: {formatCDF(customer.debtBalanceUSD * exchangeRate)}
                    </p>
                  )}
                  <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1.5 border-t border-slate-200/60 mt-1.5">
                    <span>Limite Crédit Max :</span>
                    <span className="font-bold text-slate-700">{formatUSD(customer.creditLimitUSD)}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons Footer */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => setSelectedCustomer(customer)}
                  className="px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 rounded-xl transition flex items-center gap-1"
                >
                  <History className="w-3.5 h-3.5" />
                  Détails & Factures ({customerSales.length})
                </button>

                {hasDebt && (
                  <button
                    onClick={() => {
                      const activeDebt = customerDebts.find((d) => d.remainingBalanceUSD > 0) || customerDebts[0];
                      if (activeDebt) {
                        handleOpenRepayment(activeDebt);
                      } else {
                        alert('Aucun dossier de dette détaillé actif.');
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs transition flex items-center gap-1"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    Encaisser dette
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Customer Full Detail & Financial Audit Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col my-auto">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">{selectedCustomer.name}</h3>
                <p className="text-xs text-sky-300">
                  {selectedCustomer.phone} • {selectedCustomer.city}
                </p>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
              {/* Debt & Credit summary bar */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-xs text-slate-500 font-semibold">Dette Restante Due</span>
                  <p className="text-xl font-black text-amber-700">
                    {formatUSD(selectedCustomer.debtBalanceUSD)}
                  </p>
                  <p className="text-[11px] text-amber-800 font-bold">
                    {formatCDF(selectedCustomer.debtBalanceUSD * exchangeRate)}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-500 font-semibold">Plafond Crédit Autorisé</span>
                  <p className="text-xl font-black text-slate-800">
                    {formatUSD(selectedCustomer.creditLimitUSD)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Marge disponible: {formatUSD(Math.max(0, selectedCustomer.creditLimitUSD - selectedCustomer.debtBalanceUSD))}
                  </p>
                </div>
              </div>

              {/* Debt Records & Payment History */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-sky-600" />
                  Dossiers de Crédit & Remboursements
                </h4>

                {debts.filter((d) => d.partyId === selectedCustomer.id && d.type === 'CUSTOMER').length > 0 ? (
                  debts
                    .filter((d) => d.partyId === selectedCustomer.id && d.type === 'CUSTOMER')
                    .map((debt) => (
                      <div
                        key={debt.id}
                        className="p-3 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">
                            Facture Réf: {debt.referenceInvoice}
                          </span>
                          <span
                            className={`font-black px-2 py-0.5 rounded-full text-[10px] ${
                              debt.remainingBalanceUSD > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {debt.remainingBalanceUSD > 0
                              ? `Reste: ${formatUSD(debt.remainingBalanceUSD)}`
                              : 'Totalement Soldé'}
                          </span>
                        </div>

                        <div className="flex justify-between text-slate-500 text-[11px]">
                          <span>Montant Initial: {formatUSD(debt.initialAmountUSD)}</span>
                          <span>Déjà Remboursé: {formatUSD(debt.paidAmountUSD)}</span>
                        </div>

                        {/* Payment History list */}
                        {debt.history.length > 0 && (
                          <div className="border-t border-slate-100 pt-2 space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">
                              Versements effectués :
                            </span>
                            {debt.history.map((h) => (
                              <div
                                key={h.id}
                                className="flex justify-between items-center text-[11px] bg-slate-50 p-1.5 rounded-lg"
                              >
                                <span>
                                  {formatDateLubumbashi(h.date)} ({h.receiptNumber}) - {h.paymentMethod}
                                </span>
                                <span className="font-bold text-emerald-700">
                                  +{formatUSD(h.amountUSD)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {debt.remainingBalanceUSD > 0 && (
                          <div className="pt-2 flex justify-end">
                            <button
                              onClick={() => handleOpenRepayment(debt)}
                              className="px-3 py-1 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700"
                            >
                              Encaisser ce montant
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                ) : (
                  <p className="text-xs text-slate-400 italic py-2">Aucun dossier de dette pour ce client.</p>
                )}
              </div>

              {/* Purchase history */}
              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-sky-600" />
                  Factures d'Achats Passées
                </h4>

                <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                  {sales.filter((s) => s.customerId === selectedCustomer.id).length > 0 ? (
                    sales
                      .filter((s) => s.customerId === selectedCustomer.id)
                      .map((sale) => (
                        <div
                          key={sale.id}
                          onClick={() => {
                            setSelectedCustomer(null);
                            onOpenReceiptForSale(sale);
                          }}
                          className="py-2.5 flex items-center justify-between text-xs hover:bg-slate-50 px-2 rounded-xl transition cursor-pointer"
                        >
                          <div>
                            <p className="font-bold text-slate-800">{sale.invoiceNumber}</p>
                            <p className="text-[11px] text-slate-400">
                              {formatDateLubumbashi(sale.date)} • {sale.items.length} articles
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-black text-slate-900">{formatUSD(sale.totalUSD)}</p>
                            <span className="text-[10px] text-sky-600 underline">Imprimer</span>
                          </div>
                        </div>
                      ))
                  ) : (
                    <p className="text-xs text-slate-400 italic py-2">Aucun achat enregistré à ce nom.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedCustomer(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-xl"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 my-auto">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-base">
                {editingCustomer ? 'Modifier Fiche Client' : 'Nouveau Client'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-4 sm:p-6 space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Nom Complet ou Raison Sociale *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Entreprise GEMA SARL, Patrick Tshilombo..."
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Téléphone *</label>
                  <input
                    type="tel"
                    required
                    placeholder="+243..."
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Ville</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Adresse physique / Quartier</label>
                  <input
                    type="text"
                    placeholder="Ex: Av. Kasavubu N° 45, C/Lubumbashi"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="contact@..."
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Limite de Crédit Autorisée (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={formData.creditLimitUSD}
                    onChange={(e) => setFormData({ ...formData, creditLimitUSD: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Notes / Infos Chantiers</label>
                  <input
                    type="text"
                    placeholder="Ex: Architecte réputé, chantiers Golf..."
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-md"
                >
                  Enregistrer Client
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Debt Repayment Modal */}
      {isRepaymentModalOpen && repaymentDebtRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200 my-auto">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Enregistrer un Remboursement</h3>
                <p className="text-xs text-sky-300">{repaymentDebtRecord.partyName}</p>
              </div>
              <button
                onClick={() => setIsRepaymentModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteRepayment} className="p-4 sm:p-6 space-y-4">
              {repaymentError && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-2.5 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{repaymentError}</span>
                </div>
              )}

              <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-200 flex justify-between items-center text-xs">
                <div>
                  <span className="text-amber-800 font-semibold">Reste dû :</span>
                  <p className="text-lg font-black text-amber-900">
                    {formatUSD(repaymentDebtRecord.remainingBalanceUSD)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-amber-800 font-semibold">En Francs :</span>
                  <p className="text-sm font-bold text-amber-900">
                    {formatCDF(repaymentDebtRecord.remainingBalanceUSD * exchangeRate)}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Montant Remboursé (USD) *
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  max={repaymentDebtRecord.remainingBalanceUSD}
                  required
                  value={repaymentAmountUSD}
                  onChange={(e) => setRepaymentAmountUSD(parseFloat(e.target.value) || 0)}
                  className="w-full text-base font-black p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-[11px] text-sky-700 font-bold mt-1">
                  Équiv: {formatCDF(repaymentAmountUSD * exchangeRate)}
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Mode de Paiement</label>
                <select
                  value={repaymentMethod}
                  onChange={(e) => setRepaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-medium"
                >
                  <option value="CASH">Espèces (Cash)</option>
                  <option value="MOBILE_MONEY">Mobile Money (M-Pesa / Airtel / Orange)</option>
                  <option value="BANK_TRANSFER">Virement Bancaire (Rawbank, EquityBCDC...)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Notes / Référence du versement</label>
                <input
                  type="text"
                  placeholder="Ex: Versement comptant bureau ou réf transaction"
                  value={repaymentNotes}
                  onChange={(e) => setRepaymentNotes(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRepaymentModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md"
                >
                  Valider & Générer Reçu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
