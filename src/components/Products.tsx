import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Barcode,
  Filter,
  AlertCircle,
  AlertTriangle,
  Edit2,
  Trash2,
  Layers,
  History,
  X,
  Check,
  Tag,
  DollarSign,
  Package,
  ArrowUpDown,
  FolderPlus,
} from 'lucide-react';
import { Product, Category, StockMovement, UnitOfMeasure, ProductVariant, UserRole } from '../types';
import { formatUSD, formatCDF } from '../utils/currency';

interface ProductsProps {
  products: Product[];
  categories: Category[];
  stockMovements: StockMovement[];
  exchangeRate: number;
  userRole: UserRole;
  onSaveProduct: (productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => void;
  onDeleteProduct: (id: string) => void;
  onSaveCategory: (cat: Category) => void;
  onAddCategory: (name: string, description: string) => void;
  onDeleteCategory: (id: string) => boolean;
  onOpenBarcodeScanner: () => void;
}

export const Products: React.FC<ProductsProps> = ({
  products,
  categories,
  stockMovements,
  exchangeRate,
  userRole,
  onSaveProduct,
  onDeleteProduct,
  onAddCategory,
  onDeleteCategory,
  onOpenBarcodeScanner,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW' | 'OUT'>('ALL');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingHistoryProduct, setViewingHistoryProduct] = useState<Product | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  // Form states for product add/edit
  const [formData, setFormData] = useState({
    sku: '',
    barcode: '',
    name: '',
    description: '',
    categoryId: categories[0]?.id || '',
    brand: '',
    photoUrl: '',
    buyPriceUSD: 0,
    sellPriceUSD: 0,
    currentStock: 0,
    minStock: 5,
    unit: 'pcs' as UnitOfMeasure,
    variants: [] as ProductVariant[],
  });

  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantValue, setNewVariantValue] = useState('');

  const canEdit = userRole === 'ADMIN' || userRole === 'GESTIONNAIRE';

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.barcode.includes(searchTerm) ||
        p.brand.toLowerCase().includes(searchTerm.toLowerCase());

      const matchCategory = selectedCategory === 'ALL' || p.categoryId === selectedCategory;

      let matchStock = true;
      if (stockFilter === 'LOW') {
        matchStock = p.currentStock > 0 && p.currentStock <= p.minStock;
      } else if (stockFilter === 'OUT') {
        matchStock = p.currentStock <= 0;
      }

      return matchSearch && matchCategory && matchStock;
    });
  }, [products, searchTerm, selectedCategory, stockFilter]);

  const handleOpenAddModal = () => {
    setEditingProduct(null);
    const defaultSku = `ART-${Math.floor(1000 + Math.random() * 9000)}`;
    const defaultBarcode = `600${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    setFormData({
      sku: defaultSku,
      barcode: defaultBarcode,
      name: '',
      description: '',
      categoryId: categories[0]?.id || '',
      brand: '',
      photoUrl: '',
      buyPriceUSD: 0,
      sellPriceUSD: 0,
      currentStock: 0,
      minStock: 5,
      unit: 'pcs',
      variants: [],
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (p: Product) => {
    setEditingProduct(p);
    setFormData({
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      brand: p.brand,
      photoUrl: p.photoUrl,
      buyPriceUSD: p.buyPriceUSD,
      sellPriceUSD: p.sellPriceUSD,
      currentStock: p.currentStock,
      minStock: p.minStock,
      unit: p.unit,
      variants: p.variants || [],
    });
    setIsModalOpen(true);
  };

  const handleSaveProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    onSaveProduct({
      id: editingProduct ? editingProduct.id : undefined,
      sku: formData.sku,
      barcode: formData.barcode,
      name: formData.name,
      description: formData.description,
      categoryId: formData.categoryId,
      brand: formData.brand,
      photoUrl: formData.photoUrl,
      buyPriceUSD: Number(formData.buyPriceUSD),
      sellPriceUSD: Number(formData.sellPriceUSD),
      currentStock: Number(formData.currentStock),
      minStock: Number(formData.minStock),
      unit: formData.unit,
      variants: formData.variants,
    });

    setIsModalOpen(false);
  };

  const handleAddVariant = () => {
    if (newVariantName.trim() && newVariantValue.trim()) {
      setFormData({
        ...formData,
        variants: [
          ...formData.variants,
          { name: newVariantName.trim(), value: newVariantValue.trim() },
        ],
      });
      setNewVariantName('');
      setNewVariantValue('');
    }
  };

  const handleRemoveVariant = (index: number) => {
    setFormData({
      ...formData,
      variants: formData.variants.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto px-3 sm:px-4 pt-3">
      {/* Header and Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-sky-600" />
            Gestion des Produits & Stocks
          </h2>
          <p className="text-xs text-slate-500">
            {products.length} articles répertoriés • {categories.length} catégories
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenBarcodeScanner}
            className="px-3.5 py-2 rounded-2xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm hover:bg-slate-800 transition"
          >
            <Barcode className="w-4 h-4 text-sky-400" />
            Scanner
          </button>

          {canEdit && (
            <>
              <button
                onClick={() => setIsCategoryModalOpen(true)}
                className="px-3 py-2 rounded-2xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 transition"
              >
                <FolderPlus className="w-4 h-4 text-slate-500" />
                Catégories
              </button>
              <button
                onClick={handleOpenAddModal}
                className="px-4 py-2 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition"
              >
                <Plus className="w-4 h-4" />
                Nouveau Produit
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2.5">
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par nom, SKU, code-barres, marque..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-none"
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

          {/* Category Dropdown */}
          <div className="flex items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-none font-medium text-slate-700"
            >
              <option value="ALL">Toutes catégories ({products.length})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {/* Stock Level Quick Filter */}
            <div className="flex bg-slate-100 p-1 rounded-xl text-xs">
              <button
                onClick={() => setStockFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  stockFilter === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Tous
              </button>
              <button
                onClick={() => setStockFilter('LOW')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  stockFilter === 'LOW' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600'
                }`}
              >
                Faible
              </button>
              <button
                onClick={() => setStockFilter('OUT')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  stockFilter === 'OUT' ? 'bg-red-500 text-white shadow-xs' : 'text-slate-600'
                }`}
              >
                Rupture
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredProducts.map((product) => {
          const isOut = product.currentStock <= 0;
          const isLow = product.currentStock > 0 && product.currentStock <= product.minStock;
          const margin = product.sellPriceUSD - product.buyPriceUSD;
          const marginPct = product.buyPriceUSD > 0 ? Math.round((margin / product.buyPriceUSD) * 100) : 0;

          return (
            <div
              key={product.id}
              className="bg-white rounded-3xl border border-slate-200 shadow-xs hover:shadow-md transition-all overflow-hidden flex flex-col justify-between group"
            >
              <div className="p-4 space-y-3">
                {/* Header: Photo, Status Badge & Title */}
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
                    {product.photoUrl && <img
                      src={product.photoUrl}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md truncate">
                        {product.categoryName || 'Général'}
                      </span>
                      {isOut ? (
                        <span className="text-[10px] font-black text-red-700 bg-red-100 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                          <AlertCircle className="w-3 h-3" />
                          Rupture
                        </span>
                      ) : isLow ? (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                          <AlertTriangle className="w-3 h-3" />
                          Stock bas
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
                          En Stock
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-slate-900 text-sm mt-1 truncate" title={product.name}>
                      {product.name}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-mono">
                      SKU: {product.sku} • {product.brand || 'BTA'}
                    </p>
                  </div>
                </div>

                {/* Stock Quantity Progress Bar */}
                <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100 space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Disponible :</span>
                    <span className={`font-black ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-slate-800'}`}>
                      {product.currentStock} {product.unit}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(5, (product.currentStock / (product.minStock * 3 || 15)) * 100))}%`,
                      }}
                      className={`h-full rounded-full ${
                        isOut ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                    ></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Alerte min: {product.minStock} {product.unit}</span>
                    <span className="font-mono text-slate-500">{product.barcode}</span>
                  </div>
                </div>

                {/* Pricing Box */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Prix de Vente</span>
                    <span className="text-base font-black text-[#0F2444]">
                      {formatUSD(product.sellPriceUSD)}
                    </span>
                    <span className="text-[10px] text-sky-700 font-bold block">
                      {formatCDF(product.sellPriceUSD * exchangeRate)}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">Achat: {formatUSD(product.buyPriceUSD)}</span>
                    <span className="text-[11px] font-bold text-emerald-600">
                      Marge: +{formatUSD(margin)} (+{marginPct}%)
                    </span>
                  </div>
                </div>

                {/* Variants pills if any */}
                {product.variants && product.variants.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {product.variants.map((v, i) => (
                      <span key={i} className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg border border-slate-200">
                        {v.name}: <strong className="font-semibold">{v.value}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons Footer */}
              <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => setViewingHistoryProduct(product)}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-sky-700 flex items-center gap-1 rounded-lg hover:bg-slate-200/60 transition"
                  title="Historique des mouvements de stock"
                >
                  <History className="w-3.5 h-3.5" />
                  Mouvements
                </button>

                {canEdit && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEditModal(product)}
                      className="p-1.5 text-slate-600 hover:text-sky-600 rounded-lg hover:bg-sky-50 transition"
                      title="Modifier"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {userRole === 'ADMIN' && (
                      <button
                        onClick={() => {
                          if (confirm(`Confirmez-vous la suppression de "${product.name}" ?`)) {
                            onDeleteProduct(product.id);
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredProducts.length === 0 && (
        <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 space-y-2">
          <Package className="w-10 h-10 text-slate-300 mx-auto" />
          <h4 className="font-bold text-slate-800">Aucun produit trouvé</h4>
          <p className="text-xs text-slate-500">
            Ajustez vos filtres ou ajoutez une nouvelle référence au stock.
          </p>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 my-auto">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-base">
                {editingProduct ? 'Modifier Produit' : 'Nouveau Produit au Catalogue'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProductSubmit} className="p-4 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Code SKU *</label>
                  <input
                    type="text"
                    required
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Code-barres EAN *</label>
                  <input
                    type="text"
                    required
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Désignation du produit *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Ciment Dangote 42.5R, Fer 12mm..."
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Catégorie</label>
                  <select
                    value={formData.categoryId}
                    onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Marque / Fabricant</label>
                  <input
                    type="text"
                    placeholder="Ex: Dangote, Bosch, Schneider..."
                    value={formData.brand}
                    onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Prix d'Achat (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.buyPriceUSD}
                    onChange={(e) => setFormData({ ...formData, buyPriceUSD: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Prix de Vente (USD) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formData.sellPriceUSD}
                    onChange={(e) => setFormData({ ...formData, sellPriceUSD: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-bold text-sky-700"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Équiv. CDF: {formatCDF(formData.sellPriceUSD * exchangeRate)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Stock Actuel</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.currentStock}
                    onChange={(e) => setFormData({ ...formData, currentStock: parseInt(e.target.value, 10) || 0 })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Seuil Min. Alerte</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.minStock}
                    onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value, 10) || 5 })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Unité</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value as UnitOfMeasure })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="pcs">Pièce (pcs)</option>
                    <option value="sac">Sac (sac)</option>
                    <option value="carton">Carton (carton)</option>
                    <option value="kg">Kilogramme (kg)</option>
                    <option value="m">Mètre (m)</option>
                    <option value="litre">Litre (L)</option>
                    <option value="paquet">Paquet</option>
                  </select>
                </div>
              </div>

              {/* Variants Section */}
              <div className="border border-slate-200 rounded-2xl p-3 bg-slate-50 space-y-2">
                <label className="text-xs font-bold text-slate-700 block">Variantes (Taille, Couleur, Modèle)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type (ex: Couleur)"
                    value={newVariantName}
                    onChange={(e) => setNewVariantName(e.target.value)}
                    className="flex-1 text-xs p-2 bg-white border border-slate-200 rounded-xl"
                  />
                  <input
                    type="text"
                    placeholder="Valeur (ex: Rouge)"
                    value={newVariantValue}
                    onChange={(e) => setNewVariantValue(e.target.value)}
                    className="flex-1 text-xs p-2 bg-white border border-slate-200 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={handleAddVariant}
                    className="px-3 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
                  >
                    Ajouter
                  </button>
                </div>

                {formData.variants.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {formData.variants.map((v, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-[11px] bg-white border border-slate-300 px-2.5 py-1 rounded-lg"
                      >
                        {v.name}: <strong>{v.value}</strong>
                        <button
                          type="button"
                          onClick={() => handleRemoveVariant(i)}
                          className="text-red-500 hover:text-red-700 ml-1"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Stock Movements History Modal */}
      {viewingHistoryProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm sm:text-base">Historique des Mouvements de Stock</h3>
                <p className="text-xs text-sky-300 truncate max-w-sm">{viewingHistoryProduct.name}</p>
              </div>
              <button
                onClick={() => setViewingHistoryProduct(null)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {stockMovements.filter((m) => m.productId === viewingHistoryProduct.id).length > 0 ? (
                stockMovements
                  .filter((m) => m.productId === viewingHistoryProduct.id)
                  .map((m) => (
                    <div
                      key={m.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-black text-xs px-2 py-0.5 rounded-md ${
                              m.quantity > 0
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity} {viewingHistoryProduct.unit}
                          </span>
                          <span className="font-bold text-slate-800">{m.type}</span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-1">{m.reason}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Par: {m.userName} • Réf: {m.referenceNumber} • Stock après: {m.newStock}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                        {new Date(m.date).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))
              ) : (
                <p className="text-center text-xs text-slate-400 py-6">
                  Aucun mouvement enregistré pour ce produit.
                </p>
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setViewingHistoryProduct(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-xl"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Management Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
            <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-base">Gestion des Catégories</h3>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Add category form */}
              <div className="space-y-2 border-b border-slate-200 pb-4">
                <label className="text-xs font-bold text-slate-700">Nouvelle Catégorie</label>
                <input
                  type="text"
                  placeholder="Nom de la catégorie..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                />
                <input
                  type="text"
                  placeholder="Description..."
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newCatName.trim()) {
                      onAddCategory(newCatName.trim(), newCatDesc.trim());
                      setNewCatName('');
                      setNewCatDesc('');
                    }
                  }}
                  className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-xs"
                >
                  Ajouter la catégorie
                </button>
              </div>

              {/* Existing categories list */}
              <div className="space-y-2 max-h-56 overflow-y-auto">
                <label className="text-xs font-bold text-slate-500">Catégories Existantes</label>
                {categories.map((c) => {
                  const count = products.filter((p) => p.categoryId === c.id).length;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-800">{c.name}</p>
                        <p className="text-[10px] text-slate-400">{count} produit(s) associé(s)</p>
                      </div>
                      {userRole === 'ADMIN' && (
                        <button
                          onClick={() => {
                            const success = onDeleteCategory(c.id);
                            if (!success) {
                              alert('Impossible de supprimer cette catégorie car elle contient des produits.');
                            }
                          }}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
