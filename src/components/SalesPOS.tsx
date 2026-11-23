import React, { useState, useMemo } from 'react';
import {
  Search,
  ShoppingCart,
  Barcode,
  Trash2,
  Plus,
  Minus,
  Check,
  User as UserIcon,
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  Receipt,
  AlertTriangle,
  History,
  X,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Product, Customer, Sale, PaymentMethod, User } from '../types';
import { formatUSD, formatCDF, usdToCdf, formatDateLubumbashi } from '../utils/currency';

interface SalesPOSProps {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  exchangeRate: number;
  currentUser: User;
  canCreate?: boolean;
  onExecuteSale: (saleInput: {
    customerId?: string;
    customerName: string;
    customerPhone?: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPriceUSD: number;
    }>;
    discountUSD: number;
    paymentMethod: PaymentMethod;
    currency?: 'USD' | 'CDF';
    amountPaidUSD: number;
    notes?: string;
    allowNegativeStock?: boolean;
  }) => { success: boolean; sale?: Sale; error?: string };
  onOpenReceipt: (sale: Sale) => void;
  onOpenBarcodeScanner: () => void;
  cart: Array<{ product: Product; quantity: number; unitPriceUSD: number }>;
  onUpdateCart: (newCart: Array<{ product: Product; quantity: number; unitPriceUSD: number }>) => void;
}

export const SalesPOS: React.FC<SalesPOSProps> = ({
  products,
  customers,
  sales,
  exchangeRate,
  canCreate = true,
  onExecuteSale,
  onOpenReceipt,
  onOpenBarcodeScanner,
  cart,
  onUpdateCart,
}) => {
  const [activeView, setActiveView] = useState<'POS' | 'HISTORY'>('POS');
  const [searchTerm, setSearchTerm] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [discountUSD, setDiscountUSD] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountReceivedUSD, setAmountReceivedUSD] = useState<number>(0);
  const [amountReceivedCDF, setAmountReceivedCDF] = useState<number>(0);
  const [currencyPaidType, setCurrencyPaidType] = useState<'USD' | 'CDF'>('USD');
  const [notes, setNotes] = useState('');
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const normalizedHistorySearch = historySearch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const filteredSales = useMemo(() => sales.filter((sale) => !normalizedHistorySearch || [
    sale.invoiceNumber, sale.customerName, sale.customerPhone, sale.cashierName,
    sale.paymentMethod, sale.status, sale.items.map((item) => `${item.productName} ${item.sku}`).join(' '),
    sale.date, sale.totalUSD,
  ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedHistorySearch)), [sales, normalizedHistorySearch]);

  // Cart financial calculations
  const subtotalUSD = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity * item.unitPriceUSD, 0);
  }, [cart]);

  const totalUSD = useMemo(() => {
    return Math.max(0, subtotalUSD - (discountUSD || 0));
  }, [subtotalUSD, discountUSD]);

  const totalCDF = useMemo(() => {
    return usdToCdf(totalUSD, exchangeRate);
  }, [totalUSD, exchangeRate]);

  // Selected customer info
  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId);
  }, [customers, selectedCustomerId]);

  // Product search in POS
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.barcode.includes(searchTerm);
      const matchCategory = selectedCategory === 'ALL' || p.categoryId === selectedCategory;
      return matchSearch && matchCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  // Cart operations
  const handleAddToCart = (product: Product) => {
    const existingIndex = cart.findIndex((item) => item.product.id === product.id);
    if (existingIndex > -1) {
      const updated = [...cart];
      const nextQty = updated[existingIndex].quantity + 1;
      if (nextQty > product.currentStock) {
        alert(`Attention: Stock disponible dépassé (${product.currentStock} ${product.unit})`);
      }
      updated[existingIndex].quantity = nextQty;
      onUpdateCart(updated);
    } else {
      if (product.currentStock <= 0) {
        alert(`Attention: Ce produit est en rupture de stock !`);
      }
      onUpdateCart([
        ...cart,
        {
          product,
          quantity: 1,
          unitPriceUSD: product.sellPriceUSD,
        },
      ]);
    }
  };

  const handleUpdateQuantity = (productId: string, delta: number) => {
    const updated = cart
      .map((item) => {
        if (item.product.id === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      })
      .filter(Boolean) as Array<{ product: Product; quantity: number; unitPriceUSD: number }>;

    onUpdateCart(updated);
  };

  const handleUpdateUnitPrice = (productId: string, newPriceUSD: number) => {
    const validPrice = isNaN(newPriceUSD) ? 0 : Math.max(0, newPriceUSD);
    const updated = cart.map((item) => {
      if (item.product.id === productId) {
        return { ...item, unitPriceUSD: validPrice };
      }
      return item;
    });
    onUpdateCart(updated);
  };

  const handleRemoveFromCart = (productId: string) => {
    onUpdateCart(cart.filter((item) => item.product.id !== productId));
  };

  const handleClearCart = () => {
    if (confirm('Vider le panier de vente ?')) {
      onUpdateCart([]);
      setDiscountUSD(0);
      setSelectedCustomerId('');
      setNotes('');
    }
  };

  // Open checkout modal
  const handleOpenCheckout = () => {
    if (cart.length === 0) return;
    setErrorMessage('');
    // By default, full payment
    setAmountReceivedUSD(totalUSD);
    setAmountReceivedCDF(totalCDF);
    setCurrencyPaidType('USD');
    setIsCheckoutModalOpen(true);
  };

  // Execute Sale Submission
  const handleFinalizeSale = () => {
    setErrorMessage('');

    let finalAmountPaidUSD = 0;
    if (paymentMethod === 'CREDIT') {
      finalAmountPaidUSD = 0;
      if (!selectedCustomerId) {
        setErrorMessage('La vente à crédit exige obligatoirement la sélection d’un client enregistré.');
        return;
      }
    } else if (paymentMethod === 'PARTIAL') {
      finalAmountPaidUSD = currencyPaidType === 'USD' ? amountReceivedUSD : amountReceivedCDF / exchangeRate;
      if (!Number.isFinite(finalAmountPaidUSD) || finalAmountPaidUSD <= 0 || finalAmountPaidUSD >= totalUSD) {
        setErrorMessage('Pour un paiement partiel, l’acompte doit être supérieur à 0 et inférieur au total.');
        return;
      }
      if (!selectedCustomerId) {
        setErrorMessage('La vente partielle exige obligatoirement un client enregistré pour la dette restante.');
        return;
      }
    } else {
      finalAmountPaidUSD = totalUSD; // Full payment
    }

    // Customer credit limit check
    if (selectedCustomer && totalUSD - finalAmountPaidUSD > 0) {
      const remainingDebt = totalUSD - finalAmountPaidUSD;
      if (selectedCustomer.debtBalanceUSD + remainingDebt > selectedCustomer.creditLimitUSD) {
        const proceed = confirm(
          `Attention: Cette vente va dépasser la limite de crédit accordée à ${selectedCustomer.name} (Limite: ${formatUSD(
            selectedCustomer.creditLimitUSD
          )}, Solde actuel: ${formatUSD(selectedCustomer.debtBalanceUSD)}). Continuer quand même ?`
        );
        if (!proceed) return;
      }
    }

    // Stock check: ask for explicit confirmation before selling more than what is in stock
    const wantedByProduct = new Map<string, number>();
    cart.forEach((i) => wantedByProduct.set(i.product.id, (wantedByProduct.get(i.product.id) || 0) + i.quantity));
    const shortages = products.filter((p) => (wantedByProduct.get(p.id) || 0) > p.currentStock);
    let allowNegative = false;
    if (shortages.length > 0) {
      const list = shortages.map((p) => `${p.name} (stock ${p.currentStock})`).join(', ');
      if (!confirm(`Stock insuffisant pour : ${list}. Vendre quand même (le stock deviendra négatif) ?`)) return;
      allowNegative = true;
    }

    const result = onExecuteSale({
      customerId: selectedCustomerId || undefined,
      customerName: selectedCustomer ? selectedCustomer.name : 'Client Comptoir',
      customerPhone: selectedCustomer ? selectedCustomer.phone : undefined,
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitPriceUSD: item.unitPriceUSD,
      })),
      discountUSD: discountUSD || 0,
      paymentMethod,
      currency: currencyPaidType,
      amountPaidUSD: finalAmountPaidUSD,
      notes: notes.trim() || undefined,
      allowNegativeStock: allowNegative,
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Erreur lors de la validation de la vente');
      return;
    }

    // Success confetti
    try {
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
      });
    } catch {
      // Confetti optional
    }

    // Reset Cart
    onUpdateCart([]);
    setDiscountUSD(0);
    setSelectedCustomerId('');
    setNotes('');
    setIsCheckoutModalOpen(false);

    // Open receipt modal automatically
    if (result.sale) {
      onOpenReceipt(result.sale);
    }
  };

  // Change computation (monnaie à rendre)
  const changeUSD = Math.max(0, amountReceivedUSD - totalUSD);
  const changeCDF = Math.max(0, amountReceivedCDF - totalCDF);

  return (
    <div className="space-y-3 pb-24 max-w-7xl mx-auto px-2 sm:px-4 pt-2">
      {/* Top Switcher: Caisse POS vs Historique des Factures */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex bg-slate-100 p-1 rounded-2xl text-xs font-bold">
          <button
            onClick={() => setActiveView('POS')}
            className={`px-3.5 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
              activeView === 'POS' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            Caisse Enregistreuse
          </button>
          <button
            onClick={() => setActiveView('HISTORY')}
            className={`px-3.5 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
              activeView === 'HISTORY' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            Historique Factures ({sales.length})
          </button>
        </div>

        <button
          onClick={onOpenBarcodeScanner}
          className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs hover:bg-slate-800 transition"
        >
          <Barcode className="w-4 h-4 text-amber-400" />
          <span className="hidden sm:inline">Scanner</span> Douchette
        </button>
      </div>

      {activeView === 'POS' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          {/* LEFT: Products Selection Grid (7 cols) */}
          <div className="lg:col-span-7 space-y-3">
            {/* Search Bar */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Chercher article par nom, SKU ou code-barres..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-2xl shadow-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
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

            {/* Products POS Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[68vh] overflow-y-auto pr-1">
              {filteredProducts.map((p) => {
                const isOut = p.currentStock <= 0;
                const inCart = cart.find((item) => item.product.id === p.id);

                return (
                  <div
                    key={p.id}
                    onClick={() => handleAddToCart(p)}
                    className={`bg-white rounded-2xl border p-2.5 flex flex-col justify-between shadow-xs hover:shadow-md transition cursor-pointer relative overflow-hidden group ${
                      inCart ? 'border-amber-500 ring-2 ring-amber-200' : 'border-slate-200 hover:border-amber-300'
                    }`}
                  >
                    {inCart && (
                      <span className="absolute top-1.5 right-1.5 bg-amber-600 text-white font-black text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow-xs">
                        {inCart.quantity}
                      </span>
                    )}

                    <div className="space-y-1.5">
                      <div className="h-16 rounded-xl bg-slate-100 overflow-hidden">
                        <img
                          src={p.photoUrl}
                          alt={p.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                      </div>
                      <h4 className="font-bold text-slate-800 text-xs truncate" title={p.name}>
                        {p.name}
                      </h4>
                      <p className="text-[10px] text-slate-400 font-mono truncate">{p.sku}</p>
                    </div>

                    <div className="pt-2 mt-1 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="font-black text-xs text-[#0F2444] block">
                          {formatUSD(p.sellPriceUSD)}
                        </span>
                        <span className="text-[9px] text-amber-700 font-semibold block">
                          {formatCDF(p.sellPriceUSD * exchangeRate)}
                        </span>
                      </div>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          isOut
                            ? 'bg-red-100 text-red-700'
                            : p.currentStock <= p.minStock
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {p.currentStock} {p.unit}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT: Cart & Checkout Summary (5 cols) */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 shadow-md p-4 space-y-3 flex flex-col justify-between min-h-[500px]">
            <div className="space-y-3">
              {/* Cart Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-amber-600" />
                  <h3 className="font-bold text-sm text-slate-800">Panier de Vente</h3>
                  <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">
                    {cart.reduce((sum, i) => sum + i.quantity, 0)} articles
                  </span>
                </div>
                {cart.length > 0 && (
                  <button
                    onClick={handleClearCart}
                    className="text-[11px] font-semibold text-red-500 hover:text-red-700 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Vider
                  </button>
                )}
              </div>

              {/* Customer Selector */}
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">Client de la Vente :</label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Client Comptoir (Vente Directe Anonyme)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.debtBalanceUSD > 0 ? `(Dette: ${formatUSD(c.debtBalanceUSD)})` : ''}
                    </option>
                  ))}
                </select>
                {selectedCustomer && (
                  <div className="mt-1 flex items-center justify-between text-[10px] bg-slate-50 px-2.5 py-1 rounded-lg text-slate-600">
                    <span>
                      Dette actuelle: <strong className="text-amber-700">{formatUSD(selectedCustomer.debtBalanceUSD)}</strong>
                    </span>
                    <span>
                      Plafond Crédit: <strong className="text-slate-800">{formatUSD(selectedCustomer.creditLimitUSD)}</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Cart Items List */}
              <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                {cart.length > 0 ? (
                  cart.map((item) => (
                    <div
                      key={item.product.id}
                      className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-slate-800 truncate flex-1">{item.product.name}</p>
                        <strong className="text-slate-900 font-mono shrink-0">
                          {formatUSD(item.quantity * item.unitPriceUSD)}
                        </strong>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
                        {/* Editable Unit Price */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-500 font-medium">Prix unit. ($) :</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={item.unitPriceUSD}
                            onChange={(e) =>
                              handleUpdateUnitPrice(item.product.id, parseFloat(e.target.value))
                            }
                            className="w-20 px-2 py-0.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 text-right focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                            title="Modifier librement le prix unitaire pour cette vente"
                          />
                        </div>

                        {/* Quantity and Remove Controls */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleUpdateQuantity(item.product.id, -1)}
                            className="w-6 h-6 rounded-lg bg-white border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-200"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center font-bold text-xs">{item.quantity}</span>
                          <button
                            onClick={() => handleUpdateQuantity(item.product.id, 1)}
                            className="w-6 h-6 rounded-lg bg-white border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-200"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleRemoveFromCart(item.product.id)}
                            className="text-slate-400 hover:text-red-600 ml-1 p-1"
                            title="Retirer l'article"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-slate-400 space-y-1">
                    <ShoppingCart className="w-8 h-8 mx-auto opacity-30" />
                    <p className="text-xs">Le panier est vide</p>
                    <p className="text-[10px]">Sélectionnez des articles à gauche ou scannez un code-barres</p>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Total & Checkout CTA */}
            <div className="pt-3 border-t border-slate-200 space-y-2.5">
              {/* Discount Input */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-500">Remise exceptionnelle (USD) :</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={discountUSD || ''}
                  onChange={(e) => setDiscountUSD(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-24 text-right p-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                />
              </div>

              {/* Totals Display */}
              <div className="bg-[#0F2444] text-white p-3.5 rounded-2xl shadow-inner space-y-1">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-slate-300">Total Net à Payer :</span>
                  <span className="text-xl sm:text-2xl font-black text-white">{formatUSD(totalUSD)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-amber-300 text-[11px]">Équivalent en Francs Congolais :</span>
                  <span className="font-bold text-amber-300 text-sm">{formatCDF(totalCDF)}</span>
                </div>
                <div className="text-[9px] text-slate-400 text-right">
                  1 USD = {exchangeRate} FC
                </div>
              </div>

              {/* Checkout Button */}
              <button
                disabled={cart.length === 0 || !canCreate}
                onClick={handleOpenCheckout}
                className="w-full py-3 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 disabled:opacity-50 text-white rounded-2xl font-black text-sm shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-5 h-5" />
                {canCreate ? `Encaisser & Valider (${formatUSD(totalUSD)})` : 'Consultation uniquement'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* History of Sales */
        <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="font-bold text-sm text-slate-900">Historique des Factures Enregistrées</h3>
            <span className="text-xs text-slate-500">{filteredSales.length} / {sales.length} ventes</span>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Rechercher facture, client, téléphone, produit ou caissier..." className="w-full pl-9 pr-9 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500" />
            {historySearch && <button onClick={() => setHistorySearch('')} className="absolute right-3 top-2.5 text-slate-400" aria-label="Effacer la recherche"><X className="w-4 h-4" /></button>}
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto">
            {filteredSales.map((sale) => (
              <div
                key={sale.id}
                onClick={() => onOpenReceipt(sale)}
                className="py-3 px-2 flex items-center justify-between gap-3 hover:bg-slate-50 rounded-xl transition cursor-pointer"
              >
                <div className="truncate">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-800">{sale.invoiceNumber}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800">
                      {sale.paymentMethod}
                    </span>
                    {sale.debtAmountUSD > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800">
                        Dette: {formatUSD(sale.debtAmountUSD)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-1 font-semibold truncate">{sale.customerName}</p>
                  <p className="text-[10px] text-slate-400">
                    {formatDateLubumbashi(sale.date)} • Par {sale.cashierName} • {sale.items.length} articles
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-slate-900">{formatUSD(sale.totalUSD)}</p>
                  <p className="text-[10px] text-amber-700 font-bold">{formatCDF(sale.totalCDF)}</p>
                  <span className="text-[10px] text-amber-600 underline font-medium mt-1 inline-block">
                    Voir Reçu
                  </span>
                </div>
              </div>
            ))}
            {filteredSales.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Aucune facture correspondante.</p>}
          </div>
        </div>
      )}

      {/* Checkout Modal (Payment Method & Change Calculator) */}
      {isCheckoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 my-auto">
            {/* Modal Header */}
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Règlement de la Vente</h3>
                <p className="text-xs text-amber-300">
                  Client: {selectedCustomer ? selectedCustomer.name : 'Client Comptoir'}
                </p>
              </div>
              <button
                onClick={() => setIsCheckoutModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {errorMessage && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-2xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Total Summary Header */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-500 font-semibold">Total Transaction</span>
                  <p className="text-xl font-black text-[#0F2444]">{formatUSD(totalUSD)}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500 font-semibold">Total en CDF</span>
                  <p className="text-lg font-black text-amber-800">{formatCDF(totalCDF)}</p>
                  <p className="text-[10px] text-slate-400">1$ = {exchangeRate} FC</p>
                </div>
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-2">Mode de Paiement :</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CASH')}
                    className={`p-3 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      paymentMethod === 'CASH'
                        ? 'border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Banknote className="w-5 h-5 text-emerald-600" />
                    <span>Espèces (Cash)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('MOBILE_MONEY')}
                    className={`p-3 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      paymentMethod === 'MOBILE_MONEY'
                        ? 'border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Smartphone className="w-5 h-5 text-amber-600" />
                    <span>Mobile Money</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('BANK_TRANSFER')}
                    className={`p-3 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      paymentMethod === 'BANK_TRANSFER'
                        ? 'border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <CreditCard className="w-5 h-5 text-amber-600" />
                    <span>Virement</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('PARTIAL')}
                    className={`p-3 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      paymentMethod === 'PARTIAL'
                        ? 'border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Receipt className="w-5 h-5 text-purple-600" />
                    <span>Paiement Partiel</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CREDIT')}
                    className={`p-3 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      paymentMethod === 'CREDIT'
                        ? 'border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    <span>100% à Crédit</span>
                  </button>
                </div>
              </div>

              {/* Amount received inputs if cash or partial */}
              {paymentMethod !== 'CREDIT' && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">Monnaie Encaissée en :</label>
                    <div className="flex bg-slate-200 p-0.5 rounded-xl text-xs">
                      <button
                        type="button"
                        onClick={() => setCurrencyPaidType('USD')}
                        className={`px-3 py-1 rounded-lg font-bold transition ${
                          currencyPaidType === 'USD' ? 'bg-amber-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        USD ($)
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrencyPaidType('CDF')}
                        className={`px-3 py-1 rounded-lg font-bold transition ${
                          currencyPaidType === 'CDF' ? 'bg-amber-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        CDF (FC)
                      </button>
                    </div>
                  </div>

                  {currencyPaidType === 'USD' ? (
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1">Montant Reçu (USD) :</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={amountReceivedUSD}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setAmountReceivedUSD(val);
                          setAmountReceivedCDF(usdToCdf(val, exchangeRate));
                        }}
                        className="w-full text-base font-black p-2.5 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500"
                      />
                      {paymentMethod === 'CASH' && amountReceivedUSD > totalUSD && (
                        <div className="mt-2 p-2 bg-emerald-50 rounded-xl flex justify-between text-xs text-emerald-800 font-bold">
                          <span>Monnaie à rendre :</span>
                          <span>
                            {formatUSD(changeUSD)} ({formatCDF(usdToCdf(changeUSD, exchangeRate))})
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1">Montant Reçu (CDF) :</label>
                      <input
                        type="number"
                        step="500"
                        min="0"
                        value={amountReceivedCDF}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setAmountReceivedCDF(val);
                          setAmountReceivedUSD(Number((val / exchangeRate).toFixed(2)));
                        }}
                        className="w-full text-base font-black p-2.5 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 text-amber-800"
                      />
                      {paymentMethod === 'CASH' && amountReceivedCDF > totalCDF && (
                        <div className="mt-2 p-2 bg-emerald-50 rounded-xl flex justify-between text-xs text-emerald-800 font-bold">
                          <span>Monnaie à rendre :</span>
                          <span>{formatCDF(changeCDF)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'PARTIAL' && (
                    <div className="p-2.5 bg-purple-50 rounded-xl text-xs space-y-1 text-purple-900 border border-purple-200">
                      <div className="flex justify-between font-bold">
                        <span>Acompte versé :</span>
                        <span>{formatUSD(currencyPaidType === 'USD' ? amountReceivedUSD : amountReceivedCDF / exchangeRate)}</span>
                      </div>
                      <div className="flex justify-between text-red-700 font-black">
                        <span>Dette générée :</span>
                        <span>
                          {formatUSD(
                            Math.max(0, totalUSD - (currencyPaidType === 'USD' ? amountReceivedUSD : amountReceivedCDF / exchangeRate))
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes Input */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Notes / Référence transaction (optionnel)</label>
                <input
                  type="text"
                  placeholder="Ex: Réf M-Pesa 2948194, livraison prévue samedi..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleFinalizeSale}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-2xl font-black text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Check className="w-5 h-5" />
                  Valider la Vente & Imprimer Facture
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
