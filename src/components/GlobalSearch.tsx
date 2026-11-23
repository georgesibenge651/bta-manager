import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, X, Package, Users, ShoppingCart, Truck, CreditCard, Receipt,
  Layers, ClipboardList, Wallet, AlertTriangle, Gift, ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Product, Customer, Supplier, Sale, Purchase, DebtRecord, Expense,
  StockMovement, Reservation, ReservationPayment, ReservationDelivery,
  ReservationCancellation, StockDamage, FreeIssue,
} from '../types';
import type { MainTab } from './BottomNav';

type SearchDestination = { tab: MainTab; subModule?: string };
interface SearchResult {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  detail: string;
  icon: LucideIcon;
  destination: SearchDestination;
}
interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (destination: SearchDestination) => void;
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  purchases: Purchase[];
  debts: DebtRecord[];
  expenses: Expense[];
  stockMovements: StockMovement[];
  reservations: Reservation[];
  reservationPayments: ReservationPayment[];
  reservationDeliveries: ReservationDelivery[];
  reservationCancellations: ReservationCancellation[];
  stockDamages: StockDamage[];
  freeIssues: FreeIssue[];
}

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('fr-FR') : '';
const money = (value?: number) => typeof value === 'number'
  ? `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $` : '';

export const GlobalSearch: React.FC<GlobalSearchProps> = (props) => {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('TOUS');

  useEffect(() => {
    if (!props.isOpen) return;
    setQuery('');
    setKindFilter('TOUS');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // Re-arm only when the dialog opens/closes; do not reset the query on parent re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isOpen]);

  const results = useMemo<SearchResult[]>(() => {
    const rows: SearchResult[] = [];
    props.products.forEach((p) => rows.push({ id: `product-${p.id}`, kind: 'Produits', title: p.name, subtitle: `SKU ${p.sku} • ${p.categoryName || 'Sans catégorie'}`, detail: `Stock : ${p.currentStock} ${p.unit} • ${money(p.sellPriceUSD)}`, icon: Package, destination: { tab: 'produits' } }));
    props.customers.forEach((c) => rows.push({ id: `customer-${c.id}`, kind: 'Clients', title: c.name, subtitle: c.phone || c.email || 'Client', detail: c.debtBalanceUSD > 0 ? `Solde dû : ${money(c.debtBalanceUSD)}` : c.city, icon: Users, destination: { tab: 'clients' } }));
    props.suppliers.forEach((s) => rows.push({ id: `supplier-${s.id}`, kind: 'Fournisseurs', title: s.companyName, subtitle: `${s.contactName} • ${s.phone}`, detail: s.balanceDueUSD > 0 ? `Solde dû : ${money(s.balanceDueUSD)}` : s.address, icon: Truck, destination: { tab: 'menu', subModule: 'fournisseurs' } }));
    props.sales.forEach((s) => rows.push({ id: `sale-${s.id}`, kind: 'Ventes', title: s.invoiceNumber, subtitle: s.customerName, detail: `${dateLabel(s.date)} • ${money(s.totalUSD)}`, icon: ShoppingCart, destination: { tab: 'ventes' } }));
    props.purchases.forEach((p) => rows.push({ id: `purchase-${p.id}`, kind: 'Achats', title: p.purchaseNumber, subtitle: p.supplierName, detail: `${dateLabel(p.date)} • ${money(p.totalUSD)}`, icon: Truck, destination: { tab: 'menu', subModule: 'achats' } }));
    props.debts.forEach((d) => rows.push({ id: `debt-${d.id}`, kind: 'Dettes', title: d.partyName, subtitle: `${d.type === 'CUSTOMER' ? 'Client' : 'Fournisseur'} • ${d.referenceInvoice}`, detail: `Reste : ${money(d.remainingBalanceUSD)}`, icon: CreditCard, destination: { tab: 'menu', subModule: 'dettes' } }));
    props.expenses.forEach((e) => rows.push({ id: `expense-${e.id}`, kind: 'Dépenses', title: e.title, subtitle: e.category, detail: `${dateLabel(e.date)} • ${money(e.amountUSD)}${e.receiptNumber ? ` • ${e.receiptNumber}` : ''}`, icon: Receipt, destination: { tab: 'menu', subModule: 'depenses' } }));
    props.stockMovements.forEach((m) => rows.push({ id: `movement-${m.id}`, kind: 'Mouvements', title: m.productName, subtitle: `${m.type} • ${m.referenceNumber}`, detail: `${dateLabel(m.date)} • ${m.quantity} • ${m.reason}`, icon: Layers, destination: { tab: 'menu', subModule: 'mouvements' } }));
    props.reservations.forEach((r) => rows.push({ id: `reservation-${r.id}`, kind: 'Réservations', title: r.reservationNumber, subtitle: r.customerName, detail: `${r.status} • ${money(r.totalUSD)} • ${dateLabel(r.reservationDate)}`, icon: ClipboardList, destination: { tab: 'menu', subModule: 'reservations' } }));
    props.reservationPayments.forEach((p) => rows.push({ id: `reservation-payment-${p.id}`, kind: 'Avances réservation', title: p.receiptNumber, subtitle: p.reservationNumber, detail: `${dateLabel(p.paymentDate)} • ${money(p.amountUSD)}`, icon: Wallet, destination: { tab: 'menu', subModule: 'reservations' } }));
    props.reservationDeliveries.forEach((d) => rows.push({ id: `reservation-delivery-${d.id}`, kind: 'Livraisons', title: d.deliveryNumber, subtitle: `${d.customerName} • ${d.reservationNumber}`, detail: dateLabel(d.deliveryDate), icon: Truck, destination: { tab: 'menu', subModule: 'reservations' } }));
    props.reservationCancellations.forEach((c) => rows.push({ id: `reservation-cancel-${c.id}`, kind: 'Annulations', title: c.reservationNumber, subtitle: c.reason, detail: `${c.status} • ${dateLabel(c.requestedAt)}`, icon: X, destination: { tab: 'menu', subModule: 'reservations' } }));
    props.stockDamages.forEach((d) => rows.push({ id: `damage-${d.id}`, kind: 'Dommages', title: d.damageNumber, subtitle: d.productName, detail: `${d.status} • ${d.quantity} ${d.unit} • ${dateLabel(d.date)}`, icon: AlertTriangle, destination: { tab: 'menu', subModule: 'dommages' } }));
    props.freeIssues.forEach((i) => rows.push({ id: `free-issue-${i.id}`, kind: 'Sorties gratuites', title: i.issueNumber, subtitle: `${i.productName} • ${i.beneficiary}`, detail: `${i.quantity} ${i.unit} • ${dateLabel(i.date)}`, icon: Gift, destination: { tab: 'menu', subModule: 'sorties-gratuites' } }));

    const needle = normalize(query);
    if (!needle) return [];
    const filtered = rows.filter((row) => {
      const matchesKind = kindFilter === 'TOUS' || row.kind === kindFilter;
      const matchesQuery = !needle || normalize(`${row.kind} ${row.title} ${row.subtitle} ${row.detail}`).includes(needle);
      return matchesKind && matchesQuery;
    });
    return filtered.slice(0, 60);
  }, [props, query, kindFilter]);

  if (!props.isOpen) return null;
  const kinds = ['TOUS', 'Produits', 'Clients', 'Fournisseurs', 'Ventes', 'Achats', 'Dettes', 'Dépenses', 'Mouvements', 'Réservations', 'Avances réservation', 'Livraisons', 'Annulations', 'Dommages', 'Sorties gratuites'];

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm p-2 sm:p-6 flex items-start justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="w-full max-w-2xl mt-3 sm:mt-10 bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200" role="dialog" aria-modal="true" aria-label="Recherche globale">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <Search className="w-5 h-5 text-amber-700 shrink-0" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un produit, client, facture, réservation…" className="flex-1 min-w-0 outline-none text-sm text-slate-900 placeholder:text-slate-400" />
            <button onClick={props.onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500" aria-label="Fermer"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex gap-2 overflow-x-auto pt-3 pb-1">
            {kinds.map((kind) => <button key={kind} onClick={() => setKindFilter(kind)} className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition ${kindFilter === kind ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{kind === 'TOUS' ? 'Tous' : kind}</button>)}
          </div>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-2">
          {!query.trim() && <p className="px-3 py-5 text-xs text-slate-500">Saisissez un nom, numéro, téléphone, référence, SKU ou motif. La recherche couvre les données de tous les modules.</p>}
          {query.trim() && results.length === 0 && <div className="py-12 text-center text-sm text-slate-500">Aucun résultat pour « {query} ».</div>}
          {results.map((result) => {
            const Icon = result.icon;
            return <button key={result.id} onClick={() => { props.onNavigate(result.destination); props.onClose(); }} className="w-full flex items-center gap-3 p-3 rounded-2xl text-left hover:bg-amber-50 transition group">
              <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 group-hover:bg-amber-100 group-hover:text-amber-700"><Icon className="w-5 h-5" /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="text-sm text-slate-900 truncate">{result.title}</strong><span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full shrink-0">{result.kind}</span></span><span className="block text-xs text-slate-600 truncate mt-0.5">{result.subtitle}</span><span className="block text-[11px] text-slate-400 truncate mt-0.5">{result.detail}</span></span>
              <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-amber-600 shrink-0" />
            </button>;
          })}
          {results.length === 60 && <p className="text-center text-[11px] text-slate-400 py-3">60 premiers résultats affichés. Affinez votre recherche.</p>}
        </div>
        <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400"><span>{results.length} résultat(s) affiché(s)</span><span>Échap pour fermer</span></div>
      </section>
    </div>
  );
};
