import React, { useState } from 'react';
import { Truck, Plus, Phone, Mail, MapPin, Edit2, X, DollarSign } from 'lucide-react';
import { Supplier, Purchase, UserRole } from '../types';
import { formatUSD, formatCDF } from '../utils/currency';

interface SuppliersProps {
  suppliers: Supplier[];
  purchases: Purchase[];
  exchangeRate: number;
  userRole: UserRole;
  onSaveSupplier: (supplierData: Omit<Supplier, 'id' | 'registeredAt'> & { id?: string }) => void;
  onNavigateToPurchases: () => void;
}

export const Suppliers: React.FC<SuppliersProps> = ({
  suppliers,
  purchases,
  exchangeRate,
  userRole,
  onSaveSupplier,
  onNavigateToPurchases,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [formData, setFormData] = useState({
    companyName: '',
    contactName: '',
    phone: '',
    address: '',
    email: '',
    suppliedProducts: '',
    balanceDueUSD: 0,
  });

  const canEdit = userRole === 'ADMIN' || userRole === 'GESTIONNAIRE';

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.suppliedProducts.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleOpenAdd = () => {
    setEditingSupplier(null);
    setFormData({
      companyName: '',
      contactName: '',
      phone: '+243 ',
      address: '',
      email: '',
      suppliedProducts: '',
      balanceDueUSD: 0,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (s: Supplier) => {
    setEditingSupplier(s);
    setFormData({
      companyName: s.companyName,
      contactName: s.contactName,
      phone: s.phone,
      address: s.address,
      email: s.email,
      suppliedProducts: s.suppliedProducts,
      balanceDueUSD: s.balanceDueUSD,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.companyName.trim()) return;

    onSaveSupplier({
      id: editingSupplier?.id,
      companyName: formData.companyName,
      contactName: formData.contactName,
      phone: formData.phone,
      address: formData.address,
      email: formData.email,
      suppliedProducts: formData.suppliedProducts,
      balanceDueUSD: editingSupplier ? editingSupplier.balanceDueUSD : Number(formData.balanceDueUSD) || 0,
    });

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Truck className="w-5 h-5 text-amber-600" />
            Répertoire des Fournisseurs
          </h3>
          <p className="text-xs text-slate-500">
            {suppliers.length} fournisseurs • Gestion des commandes et dettes fournisseurs
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onNavigateToPurchases}
            className="px-3 py-2 rounded-2xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
          >
            Voir Approvisionnements
          </button>
          {canEdit && (
            <button
              onClick={handleOpenAdd}
              className="px-4 py-2 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md"
            >
              <Plus className="w-4 h-4" />
              Nouveau Fournisseur
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredSuppliers.map((supplier) => {
          const supplierPurchases = purchases.filter((p) => p.supplierId === supplier.id);
          const hasDebt = supplier.balanceDueUSD > 0;

          return (
            <div
              key={supplier.id}
              className="bg-white rounded-3xl border border-slate-200 p-4 space-y-3 flex flex-col justify-between shadow-xs hover:shadow-md transition"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div className="truncate">
                    <h4 className="font-bold text-sm text-slate-900 truncate">{supplier.companyName}</h4>
                    <p className="text-[11px] text-slate-500">Contact: {supplier.contactName}</p>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => handleOpenEdit(supplier)}
                      className="p-1 text-slate-400 hover:text-amber-600"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="text-xs text-slate-600 space-y-1 bg-slate-50 p-2.5 rounded-2xl border border-slate-100">
                  <p className="flex items-center gap-1.5 font-medium">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {supplier.phone}
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    {supplier.address}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">Produits: {supplier.suppliedProducts}</p>
                </div>

                <div
                  className={`p-2.5 rounded-2xl border ${
                    hasDebt ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
                  }`}
                >
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-700">Solde Dû :</span>
                    <span className={`font-black ${hasDebt ? 'text-amber-800' : 'text-emerald-800'}`}>
                      {formatUSD(supplier.balanceDueUSD)}
                    </span>
                  </div>
                  {hasDebt && (
                    <p className="text-[10px] text-amber-700 font-bold mt-0.5">
                      {formatCDF(supplier.balanceDueUSD * exchangeRate)}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-2 flex justify-between">
                <span>{supplierPurchases.length} commandes livrées</span>
                <span className="text-amber-600 font-medium">Actif</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Supplier Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 my-auto">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-base">
                {editingSupplier ? 'Modifier Fournisseur' : 'Nouveau Fournisseur'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Raison Sociale / Société *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Congo Construction Supplies Ltd..."
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Nom du Contact</label>
                  <input
                    type="text"
                    value={formData.contactName}
                    onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Téléphone *</label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Adresse ou Dépôt</label>
                <input
                  type="text"
                  placeholder="Ex: Zone Industrielle, Route Likasi..."
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Produits Fournis</label>
                <input
                  type="text"
                  placeholder="Ex: Ciment Dangote, Fers à béton, Câbles électriques..."
                  value={formData.suppliedProducts}
                  onChange={(e) => setFormData({ ...formData, suppliedProducts: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500"
                />
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
                  className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-md"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
