import React, { useState } from 'react';
import { CreditCard, DollarSign, Calendar, History, ArrowDownRight, ArrowUpRight, X, Search } from 'lucide-react';
import { DebtRecord, PaymentMethod } from '../types';
import { formatUSD, formatCDF, formatDateLubumbashi } from '../utils/currency';
import { useLanguage } from '../i18n';

interface DebtsProps {
  debts: DebtRecord[];
  exchangeRate: number;
  canPay?: boolean;
  onRecordDebtPayment: (
    debtId: string,
    amountUSD: number,
    method: PaymentMethod,
    notes?: string
  ) => { success: boolean; error?: string; updatedDebt?: DebtRecord; receiptNumber?: string };
  onOpenDebtReceipt: (debt: DebtRecord, amountUSD: number, receiptNum: string) => void;
}

export const Debts: React.FC<DebtsProps> = ({
  debts,
  exchangeRate,
  canPay = true,
  onRecordDebtPayment,
  onOpenDebtReceipt,
}) => {
  const { language, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  const [selectedDebt, setSelectedDebt] = useState<DebtRecord | null>(null);

  // Payment form state
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmountUSD, setPaymentAmountUSD] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const normalizedSearch = searchTerm.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const filteredDebts = debts.filter((d) => d.type === activeTab && (!normalizedSearch || [d.partyName, d.partyPhone, d.referenceInvoice, d.dueDate, d.remainingBalanceUSD].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedSearch)));
  const totalRemainingUSD = filteredDebts.reduce((sum, d) => sum + d.remainingBalanceUSD, 0);

  const handleOpenPayment = (debt: DebtRecord) => {
    setSelectedDebt(debt);
    setPaymentAmountUSD(String(debt.remainingBalanceUSD));
    setPaymentMethod('CASH');
    setPaymentNotes('');
    setErrorMessage('');
    setIsPaymentModalOpen(true);
  };

  const handleExecutePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebt) return;
    setErrorMessage('');

    const res = onRecordDebtPayment(
      selectedDebt.id,
      Number(paymentAmountUSD.replace(',', '.')),
      paymentMethod,
      paymentNotes.trim() || undefined
    );

    if (!res.success) {
      setErrorMessage(res.error || t('Erreur lors du règlement', 'Error recording payment'));
      return;
    }

    setIsPaymentModalOpen(false);
    if (res.updatedDebt && res.receiptNumber) {
      onOpenDebtReceipt(res.updatedDebt, Number(paymentAmountUSD.replace(',', '.')), res.receiptNumber);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-amber-600" />
            {t('Module Indépendant des Dettes & Créances', 'Standalone Receivables & Payables Module')}
          </h3>
          <p className="text-xs text-slate-500">
            {t("Suivi des créances clients et dettes fournisseurs sans perte d'historique", 'Track customer receivables and supplier payables with a complete history')}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-slate-100 p-1 rounded-2xl text-xs font-bold">
          <button
            onClick={() => setActiveTab('CUSTOMER')}
            className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
              activeTab === 'CUSTOMER' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600'
            }`}
          >
            <ArrowDownRight className="w-4 h-4 text-emerald-400" />
            {t('Créances Clients', 'Customer Receivables')}
          </button>
          <button
            onClick={() => setActiveTab('SUPPLIER')}
            className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
              activeTab === 'SUPPLIER' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600'
            }`}
          >
            <ArrowUpRight className="w-4 h-4 text-amber-400" />
            {t('Dettes Fournisseurs', 'Supplier Payables')}
          </button>
        </div>
      </div>

      {/* Summary KPI Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-[#0F2444] rounded-3xl p-4 sm:p-5 text-white flex justify-between items-center shadow-md">
        <div>
          <span className="text-xs text-slate-300 font-semibold uppercase">
            {t('Total', 'Total')} {activeTab === 'CUSTOMER' ? t('Créances à Encaisser', 'Receivables to Collect') : t('Dettes à Régler', 'Payables Due')}
          </span>
          <p className="text-2xl font-black text-white mt-1">{formatUSD(totalRemainingUSD)}</p>
          <p className="text-xs text-amber-300 font-bold">
            {formatCDF(totalRemainingUSD * exchangeRate)}
          </p>
        </div>
        <div className="text-right text-xs text-slate-300">
          <p className="font-bold text-white">{filteredDebts.length} {t('dossiers enregistrés', 'records')}</p>
          <p className="text-[10px] text-slate-400">{t('Taux', 'Rate')}: 1$ = {exchangeRate} FC</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative bg-white rounded-2xl border border-slate-200 p-3">
        <Search className="w-4 h-4 absolute left-6 top-5 text-slate-400" />
        <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t('Rechercher par nom, téléphone, facture, échéance ou montant...', 'Search by name, phone, invoice, due date, or amount...')} className="w-full pl-8 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500" />
        {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-6 top-5 text-slate-400" aria-label={t('Effacer la recherche', 'Clear search')}><X className="w-4 h-4" /></button>}
      </div>

      {/* Debts List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredDebts.map((debt) => {
          const isCleared = debt.remainingBalanceUSD <= 0.01;

          return (
            <div
              key={debt.id}
              className="bg-white rounded-3xl border border-slate-200 p-4 space-y-3 shadow-xs hover:shadow-md transition flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{debt.partyName}</h4>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {t('Réf', 'Ref')}: {debt.referenceInvoice} • {t('Tél', 'Phone')}: {debt.partyPhone}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      isCleared ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {isCleared ? t('Entièrement Soldé', 'Paid in Full') : t('En Cours', 'Outstanding')}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-2xl text-xs text-slate-600 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 block">{t('Initial', 'Original')}</span>
                    <strong className="text-slate-800">{formatUSD(debt.initialAmountUSD)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">{t('Déjà Payé', 'Paid')}</span>
                    <strong className="text-emerald-700">{formatUSD(debt.paidAmountUSD)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">{t('Solde Dû', 'Balance Due')}</span>
                    <strong className={isCleared ? 'text-emerald-700' : 'text-amber-800'}>
                      {formatUSD(debt.remainingBalanceUSD)}
                    </strong>
                  </div>
                </div>

                {/* Repayment History preview */}
                {debt.history.length > 0 && (
                  <div className="space-y-1 text-xs pt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      {t('Historique des versements', 'Payment History')} ({debt.history.length}) :
                    </span>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      {debt.history.map((h) => (
                        <div
                          key={h.id}
                          className="flex justify-between items-center text-[11px] bg-slate-50 px-2 py-1 rounded-lg"
                        >
                          <span className="text-slate-600 truncate">
                            {formatDateLubumbashi(h.date)} ({h.receiptNumber})
                          </span>
                          <span className="font-bold text-emerald-700 shrink-0">
                            +{formatUSD(h.amountUSD)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {t('Échéance', 'Due')}: {formatDateLubumbashi(debt.dueDate, false, language === 'en' ? 'en-US' : 'fr-FR')}
                </span>

                {!isCleared && canPay && (
                  <button
                    onClick={() => handleOpenPayment(debt)}
                    className="px-3 py-1.5 text-xs font-bold bg-[#0F2444] hover:bg-amber-900 text-white rounded-xl shadow-xs transition"
                  >
                    {t('Enregistrer Versement', 'Record Payment')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Payment Settlement Modal */}
      {isPaymentModalOpen && selectedDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">{t('Enregistrer Règlement Financier', 'Record Payment')}</h3>
                <p className="text-xs text-amber-300">{selectedDebt.partyName}</p>
              </div>
              <button
                onClick={() => setIsPaymentModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecutePayment} className="p-4 sm:p-6 space-y-4">
              {errorMessage && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs">
                  {errorMessage}
                </div>
              )}

              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 flex justify-between text-xs">
                <div>
                  <span className="text-slate-500">{t('Reste à solder :', 'Remaining Balance:')}</span>
                  <p className="text-base font-black text-slate-900">
                    {formatUSD(selectedDebt.remainingBalanceUSD)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-slate-500">{t('En Francs :', 'In Francs:')}</span>
                  <p className="text-xs font-bold text-amber-800">
                    {formatCDF(selectedDebt.remainingBalanceUSD * exchangeRate)}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">{t('Montant Versé (USD) *', 'Amount Paid (USD) *')}</label>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  min="0.01"
                  max={selectedDebt.remainingBalanceUSD}
                  required
                  value={paymentAmountUSD}
                  onChange={(e) => setPaymentAmountUSD(e.target.value)}
                  className="w-full text-base font-black p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">{t('Moyen de Paiement', 'Payment Method')}</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                >
                  <option value="CASH">{t('Espèces (Cash)', 'Cash')}</option>
                  <option value="MOBILE_MONEY">Mobile Money (M-Pesa, Airtel...)</option>
                  <option value="BANK_TRANSFER">{t('Virement Bancaire', 'Bank Transfer')}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">{t('Notes / Référence', 'Notes / Reference')}</label>
                <input
                  type="text"
                  placeholder={t('Ex: Réf reçu bancaire ou versement guichet...', 'e.g., Bank receipt reference or counter payment...')}
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  {t('Annuler', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md"
                >
                  {t('Valider & Générer Reçu', 'Confirm & Generate Receipt')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
