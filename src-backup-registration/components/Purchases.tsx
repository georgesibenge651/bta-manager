import React, { useState, useMemo } from 'react';
import {
  Truck,
  Plus,
  Trash2,
  Check,
  Package,
  Calendar,
  X,
  AlertCircle,
  FileText,
  Search,
} from 'lucide-react';
import { Product, Supplier, Purchase, PaymentMethod } from '../types';
import { formatUSD, formatCDF, usdToCdf, formatDateLubumbashi } from '../utils/currency';

interface PurchasesProps {
  products: Product[];
  suppliers: Supplier[];
  purchases: Purchase[];
  exchangeRate: number;
  canCreate?: boolean;
  onExecutePurchase: (purchaseInput: {
    supplierId: string;
    items: Array<{
      productId: string;
      quantity: number;
      buyPriceUSD: number;
    }>;
    additionalFeesUSD: number;
    paymentMethod: PaymentMethod;
    amountPaidUSD: number;
    status?: 'COMPLETED' | 'DRAFT' | 'PENDING';
  }) => { success: boolean; purchase?: Purchase; error?: string };
}

export const Purchases: React.FC<PurchasesProps> = ({
  products,
  suppliers,
  purchases,
  exchangeRate,
  canCreate = true,
  onExecutePurchase,
}) => {
  const [isNewPurchaseModalOpen, setIsNewPurchaseModalOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [additionalFeesUSD, setAdditionalFeesUSD] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountPaidUSD, setAmountPaidUSD] = useState<number>(0);
  const [items, setItems] = useState<
    Array<{ productId: string; quantity: number; buyPriceUSD: number }>
  >([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Selected supplier
  const supplier = suppliers.find((s) => s.id === selectedSupplierId);
  const normalizedSearch = searchTerm.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const filteredPurchases = purchases.filter((purchase) =>
    !normalizedSearch || [
      purchase.purchaseNumber, purchase.supplierName, purchase.status,
      purchase.items.map((item) => item.productName).join(' '),
      purchase.date,
    ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedSearch)
  );

  // Financial totals
  const subtotalUSD = useMemo(() => {
    return items.reduce((sum, item) => sum + item.quantity * item.buyPriceUSD, 0);
  }, [items]);

  const totalUSD = subtotalUSD + (additionalFeesUSD || 0);
  const totalCDF = usdToCdf(totalUSD, exchangeRate);

  const handleOpenNewPurchase = () => {
    setSelectedSupplierId(suppliers[0]?.id || '');
    setAdditionalFeesUSD(0);
    setPaymentMethod('CASH');
    setAmountPaidUSD(0);
    setItems([]);
    setErrorMessage('');
    setIsNewPurchaseModalOpen(true);
  };

  const handleAddItem = (productId: string) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    const existingIndex = items.findIndex((i) => i.productId === productId);
    if (existingIndex > -1) {
      const updated = [...items];
      updated[existingIndex].quantity += 1;
      setItems(updated);
    } else {
      setItems([
        ...items,
        {
          productId,
          quantity: 1,
          buyPriceUSD: prod.buyPriceUSD,
        },
      ]);
    }
  };

  const handleUpdateItem = (index: number, key: 'quantity' | 'buyPriceUSD', value: number) => {
    const updated = [...items];
    updated[index][key] = Math.max(0, value);
    setItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, idx) => idx !== index));
  };

  const handleSubmitPurchase = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!selectedSupplierId) {
      setErrorMessage('Veuillez sélectionner un fournisseur.');
      return;
    }
    if (items.length === 0) {
      setErrorMessage('Veuillez ajouter au moins un produit à la commande.');
      return;
    }

    const res = onExecutePurchase({
      supplierId: selectedSupplierId,
      items,
      additionalFeesUSD,
      paymentMethod,
      amountPaidUSD: paymentMethod === 'CREDIT' ? 0 : amountPaidUSD || totalUSD,
      status: 'COMPLETED',
    });

    if (!res.success) {
      setErrorMessage(res.error || 'Erreur lors de la validation');
      return;
    }

    setIsNewPurchaseModalOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Truck className="w-5 h-5 text-sky-600" />
            Approvisionnements & Achats Fournisseurs
          </h3>
          <p className="text-xs text-slate-500">
            Augmente automatiquement les stocks et génère les dettes fournisseurs
          </p>
        </div>

        {canCreate && <button
          onClick={handleOpenNewPurchase}
          className="px-4 py-2 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Nouvelle Réception Stock
        </button>}
      </div>

      {/* List of Purchases */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm space-y-3">
        <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500">
          Commandes et Bons de Réception ({purchases.length})
        </h4>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Rechercher par numéro, fournisseur, produit ou statut..." className="w-full pl-9 pr-9 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-500" />
          {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-slate-400" aria-label="Effacer la recherche"><X className="w-4 h-4" /></button>}
        </div>
        <div className="divide-y divide-slate-100 overflow-x-auto">
          {filteredPurchases.map((p) => (
            <div key={p.id} className="py-3 px-2 flex items-center justify-between gap-3 hover:bg-slate-50 rounded-xl">
              <div className="truncate">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-slate-900">{p.purchaseNumber}</span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                    {p.status}
                  </span>
                  {p.debtAmountUSD > 0 && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                      Dette: {formatUSD(p.debtAmountUSD)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-700 font-semibold mt-1 truncate">{p.supplierName}</p>
                <p className="text-[10px] text-slate-400">
                  {formatDateLubumbashi(p.date)} • {p.items.length} articles réceptionnés
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-black text-slate-900">{formatUSD(p.totalUSD)}</p>
                <p className="text-[10px] text-sky-700 font-bold">{formatCDF(p.totalCDF)}</p>
                <p className="text-[10px] text-slate-400">Payé: {formatUSD(p.amountPaidUSD)}</p>
              </div>
            </div>
          ))}
          {filteredPurchases.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Aucun achat correspondant.</p>}
        </div>
      </div>

      {/* New Purchase Modal */}
      {isNewPurchaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200 my-auto">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Nouvel Approvisionnement Fournisseur</h3>
                <p className="text-xs text-sky-300">Entrée automatique en stock</p>
              </div>
              <button
                onClick={() => setIsNewPurchaseModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitPurchase} className="p-4 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {errorMessage && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Supplier Selector */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Fournisseur Partenaire *</label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.companyName} ({s.contactName} - {s.phone})
                    </option>
                  ))}
                </select>
              </div>

              {/* Add Product from Catalog */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Ajouter des articles :</label>
                <div className="flex gap-2">
                  <select
                    id="product-to-add"
                    className="flex-1 text-xs p-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Stock actuel: {p.currentStock} {p.unit})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const sel = document.getElementById('product-to-add') as HTMLSelectElement;
                      if (sel && sel.value) {
                        handleAddItem(sel.value);
                      }
                    }}
                    className="px-4 py-2 bg-[#0F2444] text-white rounded-xl text-xs font-bold"
                  >
                    Ajouter
                  </button>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2 border border-slate-200 rounded-2xl p-3 bg-slate-50">
                <span className="text-xs font-bold text-slate-600 block">Articles de la commande :</span>
                {items.length > 0 ? (
                  items.map((item, index) => {
                    const prod = products.find((p) => p.id === item.productId);
                    if (!prod) return null;

                    return (
                      <div
                        key={index}
                        className="p-2.5 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="truncate flex-1">
                          <p className="font-bold text-slate-800 truncate">{prod.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{prod.sku}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400">Qté:</span>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleUpdateItem(index, 'quantity', parseInt(e.target.value, 10) || 1)}
                              className="w-16 p-1 text-center bg-slate-50 border border-slate-200 rounded font-bold"
                            />
                            <span className="text-[10px] text-slate-500">{prod.unit}</span>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400">Prix Achat:</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={item.buyPriceUSD}
                              onChange={(e) => handleUpdateItem(index, 'buyPriceUSD', parseFloat(e.target.value) || 0)}
                              className="w-20 p-1 text-right bg-slate-50 border border-slate-200 rounded font-bold"
                            />
                            <span className="text-[10px] text-slate-500">$</span>
                          </div>

                          <span className="font-black text-slate-900 w-20 text-right">
                            {formatUSD(item.quantity * item.buyPriceUSD)}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(index)}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-center text-xs text-slate-400 py-4">Aucun article ajouté.</p>
                )}
              </div>

              {/* Additional fees & totals */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Frais de Transport / Déchargement (USD)
                  </label>
                  <input
                    type="number"
                    step="5"
                    min="0"
                    value={additionalFeesUSD || ''}
                    onChange={(e) => setAdditionalFeesUSD(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Mode de Règlement</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="CASH">Comptant Espèces (100%)</option>
                    <option value="BANK_TRANSFER">Virement Bancaire</option>
                    <option value="CREDIT">100% Crédit Fournisseur</option>
                    <option value="PARTIAL">Acompte + Dette Restante</option>
                  </select>
                </div>
              </div>

              {paymentMethod === 'PARTIAL' && (
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Acompte Payé Immédiatement (USD)
                  </label>
                  <input
                    type="number"
                    step="10"
                    min="0"
                    max={totalUSD}
                    value={amountPaidUSD}
                    onChange={(e) => setAmountPaidUSD(parseFloat(e.target.value) || 0)}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-black text-sky-800"
                  />
                </div>
              )}

              {/* Total Banner */}
              <div className="bg-[#0F2444] text-white p-3.5 rounded-2xl flex justify-between items-center">
                <div>
                  <span className="text-xs text-slate-300">Total Approvisionnement :</span>
                  <p className="text-xl font-black">{formatUSD(totalUSD)}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-sky-300">Équivalent CDF :</span>
                  <p className="text-sm font-bold text-sky-300">{formatCDF(totalCDF)}</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsNewPurchaseModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={items.length === 0}
                  className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-md disabled:opacity-50"
                >
                  Valider Réception & Entrée Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
