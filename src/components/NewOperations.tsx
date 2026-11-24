import React, { useMemo, useState } from 'react';
import { ClipboardList, AlertTriangle, Gift, Search, CalendarDays } from 'lucide-react';
import { Reservation, ReservationPayment, ReservationDelivery, ReservationCancellation, StockDamage, FreeIssue, Product, Customer, PaymentMethod, ReservationStockPolicy } from '../types';
import { formatDateLubumbashi } from '../utils/currency';
import { useLanguage } from '../i18n';

type OperationView = 'reservations' | 'dommages' | 'sorties-gratuites';
interface NewOperationsProps {
  view: OperationView;
  reservations: Reservation[];
  reservationPayments: ReservationPayment[];
  reservationDeliveries: ReservationDelivery[];
  reservationCancellations: ReservationCancellation[];
  stockDamages: StockDamage[];
  freeIssues: FreeIssue[];
  products: Product[];
  customers: Customer[];
  onCreateReservation: (input: {
    customerId: string;
    items: Array<{ productId: string; quantity: number; unitPriceUSD: number; stockPolicy: ReservationStockPolicy }>;
    initialPaymentUSD?: number;
    paymentMethod?: PaymentMethod;
    expectedDeliveryDate?: string;
    notes?: string;
  }) => { success: boolean; error?: string; reservation?: Reservation };
  onRecordReservationPayment: (reservationId: string, amountUSD: number, method: PaymentMethod, notes?: string) => { success: boolean; error?: string };
  onDeliverReservation: (input: { reservationId: string; items: Array<{ reservationItemId: string; quantity: number }>; notes?: string }) => { success: boolean; error?: string };
}
const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const dateLabel = (value: string | undefined, locale: 'fr-FR' | 'en-US') => value ? formatDateLubumbashi(value, true, locale) : '—';
const money = (value: number, locale: 'fr-FR' | 'en-US') => `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} $`;

export const NewOperations: React.FC<NewOperationsProps> = ({
  view, reservations, reservationPayments, reservationDeliveries,
  reservationCancellations, stockDamages, freeIssues, products, customers,
  onCreateReservation, onRecordReservationPayment, onDeliverReservation,
}) => {
  const { language, t } = useLanguage();
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string; price: string; policy: ReservationStockPolicy }>>([{ productId: '', quantity: '1', price: '', policy: 'BLOCK_STOCK' }]);
  const [initialPayment, setInitialPayment] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [actionReservation, setActionReservation] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [deliveryQuantities, setDeliveryQuantities] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const needle = normalize(searchTerm);
  const title = view === 'reservations' ? t('Réservations clients & livraisons', 'Customer Reservations & Deliveries') : view === 'dommages' ? t('Marchandises endommagées & pertes', 'Damaged Goods & Losses') : t('Sorties gratuites de stock', 'Free Stock Issues');
  const Icon = view === 'reservations' ? ClipboardList : view === 'dommages' ? AlertTriangle : Gift;

  const filteredReservations = useMemo(() => reservations.filter((r) => !needle || normalize([
    r.reservationNumber, r.customerName, r.customerPhone, r.status, r.notes,
    ...r.items.map((item) => `${item.productName} ${item.sku}`),
    ...reservationPayments.filter((payment) => payment.reservationId === r.id).map((payment) => payment.receiptNumber),
    ...reservationDeliveries.filter((delivery) => delivery.reservationId === r.id).map((delivery) => delivery.deliveryNumber),
    ...reservationCancellations.filter((cancellation) => cancellation.reservationId === r.id).map((cancellation) => cancellation.reason),
  ].join(' ')).includes(needle)), [reservations, reservationPayments, reservationDeliveries, reservationCancellations, needle]);
  const filteredDamages = useMemo(() => stockDamages.filter((d) => !needle || normalize([
    d.damageNumber, d.productName, d.status, d.description, d.supplierName, d.recordedByName,
  ].join(' ')).includes(needle)), [stockDamages, needle]);
  const filteredIssues = useMemo(() => freeIssues.filter((i) => !needle || normalize([
    i.issueNumber, i.productName, i.beneficiary, i.reason, i.issuedByName,
  ].join(' ')).includes(needle)), [freeIssues, needle]);

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto px-3 sm:px-4 pt-3">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center"><Icon className="w-5 h-5" /></span>
        <div><h2 className="text-lg font-black text-slate-900">{title}</h2><p className="text-xs text-slate-500">{t('Consultation et recherche dans les opérations enregistrées hors connexion', 'Browse and search recorded offline operations')}</p></div>
      </div>
      <div className="relative bg-white rounded-2xl border border-slate-200 p-3">
        <Search className="w-4 h-4 absolute left-6 top-5 text-slate-400" />
        <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t('Rechercher par référence, client, produit, bénéficiaire ou statut...', 'Search by reference, customer, product, beneficiary, or status...')} className="w-full pl-8 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500" />
      </div>

      {view === 'reservations' && <>
        <div className="flex justify-end">
          <button onClick={() => { setShowCreate((v) => !v); setFeedback(''); }} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 text-white px-4 py-3 text-xs font-black shadow-sm">
            <span className="text-lg leading-none">+</span> {t('Nouvelle réservation', 'New Reservation')}
          </button>
        </div>
        {feedback && <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 p-3 text-xs font-semibold">{feedback}</div>}
        {showCreate && <section className="bg-white border border-amber-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-black text-slate-900">{t('Créer une réservation', 'Create Reservation')}</h3><button onClick={() => setShowCreate(false)} className="text-xs text-slate-500">{t('Fermer', 'Close')}</button></div>
          <label className="block text-xs font-bold text-slate-600">{t('Client', 'Customer')}
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm bg-white">
              <option value="">{t('Sélectionner un client', 'Select a customer')}</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `— ${c.phone}` : ''}</option>)}
            </select>
          </label>
          <div className="space-y-2"><div className="flex justify-between items-center"><span className="text-xs font-black text-slate-700">{t('Produits à réserver', 'Products to Reserve')}</span><button onClick={() => setLines((old) => [...old, { productId: '', quantity: '1', price: '', policy: 'BLOCK_STOCK' }])} className="text-xs font-bold text-amber-700">+ {t('Ajouter un produit', 'Add a Product')}</button></div>
          {lines.map((line, index) => {
            const selected = products.find((p) => p.id === line.productId);
            return <div key={index} className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
              <div className="flex justify-between"><span className="text-[11px] font-bold text-slate-500">{t('Produit', 'Product')} {index + 1}</span>{lines.length > 1 && <button onClick={() => setLines((old) => old.filter((_, i) => i !== index))} className="text-[11px] text-red-600">{t('Supprimer', 'Remove')}</button>}</div>
              <select value={line.productId} onChange={(e) => { const product = products.find((p) => p.id === e.target.value); setLines((old) => old.map((v, i) => i === index ? { ...v, productId: e.target.value, price: product ? String(product.sellPriceUSD) : '' } : v)); }} className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white"><option value="">{t('Choisir un produit', 'Select a product')}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} — {t('Stock', 'Stock')}: {p.currentStock} {p.unit}</option>)}</select>
              <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-500">{t('Quantité', 'Quantity')}<input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setLines((old) => old.map((v, i) => i === index ? { ...v, quantity: e.target.value } : v))} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"/></label><label className="text-[11px] text-slate-500">{t('Prix unitaire ($)', 'Unit Price ($)')}<input type="number" min="0" step="0.01" value={line.price} onChange={(e) => setLines((old) => old.map((v, i) => i === index ? { ...v, price: e.target.value } : v))} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"/></label></div>
              <label className="block text-[11px] text-slate-500">{t('Gestion du stock', 'Stock Handling')}<select value={line.policy} onChange={(e) => setLines((old) => old.map((v, i) => i === index ? { ...v, policy: e.target.value as ReservationStockPolicy } : v))} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs bg-white"><option value="BLOCK_STOCK">{t('Bloquer le stock dès la réservation', 'Reserve stock immediately')}</option><option value="BLOCK_ON_DELIVERY">{t('Déduire/réserver au moment de la livraison', 'Deduct/reserve stock upon delivery')}</option></select></label>
              {selected && <p className="text-[11px] text-slate-500">{t('Sous-total', 'Subtotal')}: {(Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.price) || 0)).toLocaleString(locale)} $</p>}
            </div>;
          })}</div>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">{t('Avance initiale ($)', 'Initial Deposit ($)')}<input type="number" min="0" step="0.01" value={initialPayment} onChange={(e) => setInitialPayment(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label><label className="text-xs text-slate-500">{t('Mode de paiement', 'Payment Method')}<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm bg-white"><option value="CASH">{t('Espèces', 'Cash')}</option><option value="MOBILE_MONEY">Mobile Money</option><option value="BANK_TRANSFER">{t('Virement bancaire', 'Bank Transfer')}</option></select></label></div>
          <label className="block text-xs text-slate-500">{t('Date prévue de livraison', 'Expected Delivery Date')}<input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label>
          <label className="block text-xs text-slate-500">{t('Observations', 'Notes')}<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"/></label>
          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{t('Total estimé', 'Estimated Total')}: <strong>{lines.reduce((sum, line) => sum + (Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.price) || 0)), 0).toLocaleString(locale)} $</strong></div>
          <button onClick={() => {
            const items = lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitPriceUSD: Number(line.price), stockPolicy: line.policy }));
            if (!customerId) { setFeedback(t('Veuillez sélectionner un client.', 'Please select a customer.')); return; }
            if (items.some((item) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPriceUSD) || item.unitPriceUSD < 0)) { setFeedback(t('Vérifiez les produits, quantités et prix.', 'Check the products, quantities, and prices.')); return; }
            const advance = Number(initialPayment);
            if (!Number.isFinite(advance) || advance < 0) { setFeedback(t('Montant de l’avance invalide.', 'Invalid deposit amount.')); return; }
            const result = onCreateReservation({ customerId, items, initialPaymentUSD: advance, paymentMethod: advance > 0 ? paymentMethod : undefined, expectedDeliveryDate: expectedDate || undefined, notes: notes.trim() || undefined });
            if (result.success) { setFeedback(`${t('Réservation', 'Reservation')} ${result.reservation?.reservationNumber || ''} ${t('créée avec succès.', 'created successfully.')}`); setShowCreate(false); setCustomerId(''); setLines([{ productId: '', quantity: '1', price: '', policy: 'BLOCK_STOCK' }]); setInitialPayment('0'); setExpectedDate(''); setNotes(''); }
            else setFeedback(result.error || t('Impossible de créer la réservation.', 'Unable to create the reservation.'));
          }} className="w-full rounded-xl bg-amber-600 text-white p-3 text-sm font-black">{t('Enregistrer la réservation', 'Save Reservation')}</button>
        </section>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Kpi label={t('Réservations', 'Reservations')} value={reservations.length} />
          <Kpi label={t('Avances', 'Deposits')} value={reservationPayments.length} />
          <Kpi label={t('Livraisons', 'Deliveries')} value={reservationDeliveries.length} />
          <Kpi label={t('Annulations', 'Cancellations')} value={reservationCancellations.length} />
        </div>
        <div className="space-y-2">
          {filteredReservations.map((r) => {
            const delivered = r.items.reduce((sum, item) => sum + item.quantityDelivered, 0);
            const reserved = r.items.reduce((sum, item) => sum + item.quantityReserved, 0);
            const payments = reservationPayments.filter((p) => p.reservationId === r.id);
            const deliveries = reservationDeliveries.filter((d) => d.reservationId === r.id);
            return <article key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black text-sm text-slate-900">{r.reservationNumber}</p><p className="text-xs text-slate-600">{r.customerName} • {r.customerPhone}</p></div><span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700">{r.status}</span></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs"><Metric label={t('Total', 'Total')} value={money(r.totalUSD, locale)} /><Metric label={t('Avance reçue', 'Deposit Received')} value={money(r.amountPaidUSD, locale)} /><Metric label={t('Reste financier', 'Balance Due')} value={money(r.remainingAmountUSD, locale)} /><Metric label={t('Quantités livrées', 'Quantity Delivered')} value={`${delivered} / ${reserved}`} /></div>
              <div className="text-[11px] text-slate-500">{r.items.map((item) => `${item.productName} : ${item.quantityDelivered}/${item.quantityReserved} ${item.unit}`).join(' • ')}</div>
              <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-4"><span><CalendarDays className="inline w-3 h-3 mr-1" />{dateLabel(r.reservationDate, locale)}</span><span>{payments.length} {t('paiement(s)', 'payment(s)')}</span><span>{deliveries.length} {t('livraison(s)', 'delivery(ies)')}</span></div>
              {r.status !== 'CANCELLED' && r.status !== 'CANCELLATION_PENDING' && <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => { setActionReservation(actionReservation === `${r.id}:payment` ? null : `${r.id}:payment`); setPaymentAmount(''); }} className="rounded-lg border border-amber-200 text-amber-700 px-3 py-2 text-[11px] font-bold">{t('Ajouter une avance', 'Add a Deposit')}</button>
                {r.status !== 'DELIVERED' && <button onClick={() => { setActionReservation(actionReservation === `${r.id}:delivery` ? null : `${r.id}:delivery`); setDeliveryQuantities({}); }} className="rounded-lg border border-emerald-200 text-emerald-700 px-3 py-2 text-[11px] font-bold">{t('Enregistrer une livraison', 'Record a Delivery')}</button>}
              </div>}
              {actionReservation === `${r.id}:payment` && <div className="rounded-xl bg-slate-50 border p-3 space-y-2"><p className="text-xs font-bold">{t('Nouvelle avance — reste :', 'New Deposit — balance due:')} {money(r.remainingAmountUSD, locale)}</p><input type="number" min="0.01" max={r.remainingAmountUSD} step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder={t('Montant en USD', 'Amount in USD')} className="w-full rounded-lg border p-2 text-sm"/><select id={`payment-method-${r.id}`} className="w-full rounded-lg border p-2 text-xs bg-white"><option value="CASH">{t('Espèces', 'Cash')}</option><option value="MOBILE_MONEY">Mobile Money</option><option value="BANK_TRANSFER">{t('Virement bancaire', 'Bank Transfer')}</option></select><input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder={t('Note (facultatif)', 'Note (optional)')} className="w-full rounded-lg border p-2 text-xs"/><button onClick={() => { const method = (document.getElementById(`payment-method-${r.id}`) as HTMLSelectElement)?.value as PaymentMethod; const result = onRecordReservationPayment(r.id, Number(paymentAmount), method, paymentNotes || undefined); setFeedback(result.success ? t('Avance enregistrée.', 'Deposit recorded.') : result.error || t('Paiement impossible.', 'Unable to record payment.')); if (result.success) { setActionReservation(null); setPaymentAmount(''); setPaymentNotes(''); } }} className="rounded-lg bg-amber-600 text-white px-3 py-2 text-xs font-bold">{t('Enregistrer l’avance', 'Record Deposit')}</button></div>}
              {actionReservation === `${r.id}:delivery` && <div className="rounded-xl bg-slate-50 border p-3 space-y-2"><p className="text-xs font-bold">{t('Quantités à livrer', 'Quantities to Deliver')}</p>{r.items.filter((item) => item.quantityReserved > item.quantityDelivered).map((item) => <label key={item.id} className="block text-[11px] text-slate-600">{item.productName} — {t('reste', 'remaining')} {item.quantityReserved - item.quantityDelivered} {item.unit}<input type="number" min="0" max={item.quantityReserved - item.quantityDelivered} step="0.01" value={deliveryQuantities[item.id] || ''} onChange={(e) => setDeliveryQuantities((old) => ({ ...old, [item.id]: e.target.value }))} placeholder={t('Quantité livrée', 'Quantity to deliver')} className="mt-1 w-full rounded-lg border p-2 text-sm"/></label>)}<button onClick={() => { const items = r.items.map((item) => ({ reservationItemId: item.id, quantity: Number(deliveryQuantities[item.id] || 0) })).filter((item) => item.quantity > 0); const result = onDeliverReservation({ reservationId: r.id, items }); setFeedback(result.success ? t('Livraison enregistrée et stock mis à jour.', 'Delivery recorded and stock updated.') : result.error || t('Livraison impossible.', 'Unable to record delivery.')); if (result.success) setActionReservation(null); }} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-bold">{t('Confirmer la livraison', 'Confirm Delivery')}</button></div>}
            </article>;
          })}
          {filteredReservations.length === 0 && <Empty />}
        </div>
      </>}

      {view === 'dommages' && <div className="space-y-2">
        {filteredDamages.map((d) => <article key={d.id} className="bg-white border border-slate-200 rounded-2xl p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-black text-sm">{d.damageNumber} • {d.productName}</p><p className="text-xs text-slate-500">{d.description}</p></div><span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-800">{d.status}</span></div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs"><Metric label={t('Quantité', 'Quantity')} value={`${d.quantity} ${d.unit}`} /><Metric label={t('Perte estimée', 'Estimated Loss')} value={money(d.estimatedLossUSD, locale)} /><Metric label={t('Date', 'Date')} value={dateLabel(d.date, locale)} /><Metric label={t('Responsable', 'Recorded By')} value={d.recordedByName} /></div>{d.supplierName && <p className="text-[11px] text-slate-500 mt-2">{t('Fournisseur', 'Supplier')}: {d.supplierName}</p>}</article>)}
        {filteredDamages.length === 0 && <Empty />}
      </div>}

      {view === 'sorties-gratuites' && <div className="space-y-2">
        {filteredIssues.map((i) => <article key={i.id} className="bg-white border border-slate-200 rounded-2xl p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-black text-sm">{i.issueNumber} • {i.productName}</p><p className="text-xs text-slate-500">{t('Bénéficiaire', 'Beneficiary')}: {i.beneficiary}</p></div><span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">{t('Sortie gratuite', 'Free Issue')}</span></div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs"><Metric label={t('Quantité', 'Quantity')} value={`${i.quantity} ${i.unit}`} /><Metric label={t('Valeur estimée', 'Estimated Value')} value={money(i.estimatedValueUSD, locale)} /><Metric label={t('Date', 'Date')} value={dateLabel(i.date, locale)} /><Metric label={t('Responsable', 'Issued By')} value={i.issuedByName} /></div><p className="text-xs text-slate-600 mt-2">{t('Motif', 'Reason')}: {i.reason}</p></article>)}
        {filteredIssues.length === 0 && <Empty />}
      </div>}
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: number }> = ({ label, value }) => <div className="bg-white border border-slate-200 rounded-2xl p-3"><p className="text-[10px] text-slate-500">{label}</p><p className="text-xl font-black text-slate-900">{value}</p></div>;
const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] text-slate-400">{label}</p><p className="font-bold text-slate-800 break-words">{value}</p></div>;
const Empty = () => {
  const { t } = useLanguage();
  return <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-xs text-slate-400">{t('Aucun enregistrement correspondant à cette recherche.', 'No matching records found.')}</div>;
};
