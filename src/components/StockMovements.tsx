import React, { useState } from 'react';
import {
  Layers,
  ClipboardList,
  Plus,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
  History,
  Search,
} from 'lucide-react';
import { Product, StockMovement, StockMovementType, UserRole } from '../types';
import { formatDateLubumbashi } from '../utils/currency';

interface StockMovementsProps {
  products: Product[];
  stockMovements: StockMovement[];
  userRole: UserRole;
  onAddManualMovement: (data: {
    productId: string;
    productName: string;
    quantity: number;
    type: StockMovementType;
    reason: string;
    referenceNumber: string;
    previousStock: number;
    newStock: number;
  }) => void;
  onReconcileInventory: (
    adjustments: Array<{
      productId: string;
      physicalCount: number;
      reason: string;
    }>
  ) => void;
}

export const StockMovements: React.FC<StockMovementsProps> = ({
  products,
  stockMovements,
  userRole,
  onAddManualMovement,
  onReconcileInventory,
}) => {
  const [activeTab, setActiveTab] = useState<'MOVEMENTS' | 'INVENTORY'>('MOVEMENTS');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

  // Manual Adjustment Form
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '');
  const [adjustmentQty, setAdjustmentQty] = useState<number>(0);
  const [adjustmentType, setAdjustmentType] = useState<StockMovementType>('ADJUSTMENT');
  const [adjustmentReason, setAdjustmentReason] = useState('');

  // Physical Inventory Count State: productId -> physicalCount
  const [inventoryCounts, setInventoryCounts] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    products.forEach((p) => {
      initial[p.id] = p.currentStock;
    });
    return initial;
  });

  const canEdit = userRole === 'ADMIN' || userRole === 'GESTIONNAIRE';

  const normalizedSearch = searchTerm.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const filteredMovements = stockMovements.filter((m) => {
    const matchesType = typeFilter === 'ALL' || m.type === typeFilter;
    const matchesSearch = !normalizedSearch || [m.productName, m.referenceNumber, m.reason, m.userName, m.type, m.quantity, m.date].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedSearch);
    return matchesType && matchesSearch;
  });

  const handleExecuteManualMovement = (e: React.FormEvent) => {
    e.preventDefault();
    const prod = products.find((p) => p.id === selectedProductId);
    if (!prod || adjustmentQty === 0) return;

    const previousStock = prod.currentStock;
    const finalQuantity = adjustmentType === 'OUT' || adjustmentType === 'LOSS_DAMAGE'
      ? -Math.abs(adjustmentQty)
      : Math.abs(adjustmentQty);

    const newStock = previousStock + finalQuantity;
    if (newStock < 0) {
      if (!confirm('Le stock résultant sera négatif. Continuer ?')) return;
    }

    onAddManualMovement({
      productId: prod.id,
      productName: prod.name,
      quantity: finalQuantity,
      type: adjustmentType,
      reason: adjustmentReason || 'Ajustement manuel direct',
      referenceNumber: `AJU-${Date.now().toString().slice(-6)}`,
      previousStock,
      newStock,
    });

    setIsManualModalOpen(false);
    setAdjustmentQty(0);
    setAdjustmentReason('');
  };

  const handleValidateInventory = () => {
    const adjustments: Array<{ productId: string; physicalCount: number; reason: string }> = [];

    products.forEach((p) => {
      const physical = inventoryCounts[p.id];
      if (physical !== undefined && physical !== p.currentStock) {
        adjustments.push({
          productId: p.id,
          physicalCount: physical,
          reason: 'Inventaire physique périodique',
        });
      }
    });

    if (adjustments.length === 0) {
      alert('Aucun écart détecté entre le comptage physique et le stock théorique.');
      return;
    }

    if (
      confirm(
        `Confirmez-vous l'application des ajustements pour ${adjustments.length} article(s) avec écarts de stock ?`
      )
    ) {
      onReconcileInventory(adjustments);
      alert('Inventaire régularisé avec succès. Les mouvements de stock ont été enregistrés.');
      setActiveTab('MOVEMENTS');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header and Mode switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-600" />
            Traçabilité des Stocks & Inventaire Physique
          </h3>
          <p className="text-xs text-slate-500">
            Journal immuable des flux, ajustements, pertes et réconciliations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-2xl text-xs font-bold">
            <button
              onClick={() => setActiveTab('MOVEMENTS')}
              className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                activeTab === 'MOVEMENTS' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600'
              }`}
            >
              <History className="w-4 h-4" />
              Journal Mouvements
            </button>
            <button
              onClick={() => setActiveTab('INVENTORY')}
              className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                activeTab === 'INVENTORY' ? 'bg-[#0F2444] text-white shadow-xs' : 'text-slate-600'
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              Inventaire Physique
            </button>
          </div>

          {canEdit && activeTab === 'MOVEMENTS' && (
            <button
              onClick={() => setIsManualModalOpen(true)}
              className="px-3 py-2 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center gap-1 shadow-md"
            >
              <Plus className="w-4 h-4" />
              Ajustement Manuel
            </button>
          )}
        </div>
      </div>

      {activeTab === 'MOVEMENTS' ? (
        /* Movements Log */
        <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm space-y-3">
          {/* Search and Filters Bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Rechercher produit, référence, motif ou agent..." className="w-full pl-9 pr-9 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-500" />
            {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-slate-400" aria-label="Effacer la recherche"><X className="w-4 h-4" /></button>}
          </div>
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
            <span className="text-slate-500 font-bold shrink-0">Filtrer par type :</span>
            <div className="flex gap-1">
              {['ALL', 'SALE', 'PURCHASE', 'ADJUSTMENT', 'LOSS_DAMAGE'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2.5 py-1 rounded-xl font-medium transition shrink-0 ${
                    typeFilter === t ? 'bg-sky-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {t === 'ALL'
                    ? 'Tous'
                    : t === 'SALE'
                    ? 'Ventes'
                    : t === 'PURCHASE'
                    ? 'Achats'
                    : t === 'ADJUSTMENT'
                    ? 'Ajustements'
                    : 'Pertes/Casse'}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto max-h-[65vh]">
            {filteredMovements.map((m) => {
              const isPositive = m.quantity > 0;
              return (
                <div key={m.id} className="py-2.5 px-2 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 rounded-xl">
                  <div className="truncate">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-black text-xs px-2 py-0.5 rounded-lg ${
                          isPositive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {isPositive ? `+${m.quantity}` : m.quantity}
                      </span>
                      <span className="font-bold text-slate-900 truncate">{m.productName}</span>
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                        {m.type}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">{m.reason}</p>
                    <p className="text-[10px] text-slate-400">
                      Réf: {m.referenceNumber} • Agent: {m.userName} • Stock après: {m.newStock}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    {formatDateLubumbashi(m.date)}
                  </span>
                </div>
              );
            })}
            {filteredMovements.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Aucun mouvement correspondant.</p>}
          </div>
        </div>
      ) : (
        /* Physical Inventory Reconciliation Tool */
        <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h4 className="font-bold text-sm text-slate-900">Grille de Comptage Physique vs Théorique</h4>
              <p className="text-xs text-slate-500">
                Saisissez les quantités réelles comptées en magasin pour calculer l'écart instantanément
              </p>
            </div>
            {canEdit && (
              <button
                onClick={handleValidateInventory}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black shadow-md flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Valider l'Inventaire & Régulariser
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
            {products.map((p) => {
              const physical = inventoryCounts[p.id] ?? p.currentStock;
              const diff = physical - p.currentStock;

              return (
                <div key={p.id} className="py-3 px-2 flex items-center justify-between gap-3 text-xs">
                  <div className="truncate flex-1">
                    <p className="font-bold text-slate-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      SKU: {p.sku} • Stock théorique actuel: <strong>{p.currentStock} {p.unit}</strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500 font-semibold">Compté :</span>
                      <input
                        type="number"
                        min="0"
                        value={physical}
                        onChange={(e) =>
                          setInventoryCounts({
                            ...inventoryCounts,
                            [p.id]: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        className="w-20 p-1.5 text-center font-black bg-slate-50 border border-slate-300 rounded-xl"
                      />
                      <span className="text-slate-400">{p.unit}</span>
                    </div>

                    <div className="w-24 text-right">
                      {diff === 0 ? (
                        <span className="text-emerald-600 font-bold text-xs bg-emerald-50 px-2 py-0.5 rounded-md">
                          Conforme
                        </span>
                      ) : diff > 0 ? (
                        <span className="text-sky-700 font-black text-xs bg-sky-50 px-2 py-0.5 rounded-md">
                          Excédent (+{diff})
                        </span>
                      ) : (
                        <span className="text-red-700 font-black text-xs bg-red-50 px-2 py-0.5 rounded-md">
                          Perte ({diff})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Manual Movement Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-base">Ajustement Manuel de Stock</h3>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteManualMovement} className="p-4 sm:p-6 space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Produit concerné *</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Stock: {p.currentStock} {p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Type d'Opération</label>
                  <select
                    value={adjustmentType}
                    onChange={(e) => setAdjustmentType(e.target.value as StockMovementType)}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="ADJUSTMENT">Ajustement Inventaire</option>
                    <option value="LOSS_DAMAGE">Perte ou Casse (Sortie)</option>
                    <option value="RETURN_CUSTOMER">Retour Client (Entrée)</option>
                    <option value="RETURN_SUPPLIER">Retour Fournisseur (Sortie)</option>
                    <option value="IN">Entrée Exceptionnelle</option>
                    <option value="OUT">Sortie Exceptionnelle</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Quantité *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={adjustmentQty || ''}
                    onChange={(e) => setAdjustmentQty(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-black text-center"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Motif de l'ajustement *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Tôle pliée lors du déchargement, sac déchiré..."
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-md"
                >
                  Enregistrer Mouvement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
