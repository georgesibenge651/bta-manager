
import React, { useMemo, useState } from 'react';
import { CargoPackage, CargoStatus, User, CompanySettings, PaymentMethod } from '../../types';

interface CargoModuleProps {
  packages: CargoPackage[];
  settings: CompanySettings;
  currentUser: User;
  onSavePackage: (pkg: Partial<CargoPackage>) => Promise<any>;
  onAddEvent: (packageId: string, event: Partial<{ status: CargoStatus; country: string; city: string; location: string; comment: string }>) => Promise<any>;
  onAddPayment: (packageId: string, payment: Partial<{ amountUSD: number; paymentMethod: PaymentMethod; notes: string }>) => Promise<any>;
  onDeletePackage: (packageId: string) => Promise<void>;
}

const STATUS: Array<{ value: CargoStatus; label: string }> = [
  { value: 'REGISTERED', label: 'Colis enregistré' },
  { value: 'CHINA_WAREHOUSE', label: 'Entrepôt en Chine' },
  { value: 'PREPARING', label: 'En préparation' },
  { value: 'SHIPPED_CHINA', label: 'Expédié de Chine' },
  { value: 'INTERNATIONAL_TRANSIT', label: 'Transit international' },
  { value: 'TRANSIT_COUNTRY', label: 'Pays de transit' },
  { value: 'CUSTOMS', label: 'En douane' },
  { value: 'ARRIVED_DRC', label: 'Arrivé en RDC' },
  { value: 'ON_WAY_BUNIA', label: 'En route vers Bunia' },
  { value: 'ARRIVED_BUNIA', label: 'Arrivé à Bunia' },
  { value: 'AVAILABLE_PICKUP', label: 'Disponible au retrait' },
  { value: 'DELIVERED', label: 'Livré au client' },
];

const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value || 0);

const statusLabel = (status: CargoStatus) =>
  STATUS.find((item) => item.value === status)?.label || status;

const field =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500';

export const CargoModule: React.FC<CargoModuleProps> = ({
  packages,
  settings,
  currentUser,
  onSavePackage,
  onAddEvent,
  onAddPayment,
  onDeletePackage,
}) => {
  const [tab, setTab] = useState<'dashboard' | 'list' | 'new'>('dashboard');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CargoPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    packingNumber: '',
    customerName: '',
    customerPhone: '',
    supplierName: '',
    description: '',
    originCountry: 'Chine',
    originCity: '',
    destinationCountry: 'RDC',
    destinationCity: 'Bunia',
    transportMode: 'SEA' as 'AIR' | 'SEA',
    carrierName: '',
    piecesCount: '1',
    weightKg: '0',
    volumeCbm: '0',
    unitPriceUSD: '',
    expectedShippingDate: '',
  });

  const [eventForm, setEventForm] = useState({
    status: 'CHINA_WAREHOUSE' as CargoStatus,
    country: 'RDC',
    city: 'Bunia',
    location: '',
    comment: '',
  });

  const [paymentForm, setPaymentForm] = useState({
    amountUSD: '',
    paymentMethod: 'CASH' as PaymentMethod,
    notes: '',
  });

  const [photoFiles, setPhotoFiles] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState('');

  const readPhoto = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () =>
        reject(new Error('Lecture de la photo impossible.'));

      reader.onload = () => {
        const img = new Image();

        img.onerror = () =>
          reject(new Error('Format de photo non reconnu.'));

        img.onload = () => {
          const max = 1400;
          const scale = Math.min(
            1,
            max / Math.max(img.width, img.height)
          );

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));

          const ctx = canvas.getContext('2d');

          if (!ctx) {
            return reject(new Error('Compression photo indisponible.'));
          }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.76));
        };

        img.src = String(reader.result);
      };

      reader.readAsDataURL(file);
    });

  const handlePhotos = async (files: FileList | null) => {
    if (!files?.length) return;

    setPhotoError('');

    try {
      const selectedFiles = Array.from(files).filter((f) =>
        f.type.startsWith('image/')
      );

      if (selectedFiles.length !== files.length) {
        throw new Error('Sélectionnez uniquement des images.');
      }

      const converted = await Promise.all(selectedFiles.map(readPhoto));

      if (photoFiles.length + converted.length > 6) {
        throw new Error('Maximum 6 photos par colis.');
      }

      setPhotoFiles((old) => [...old, ...converted]);
    } catch (err) {
      setPhotoError(
        err instanceof Error
          ? err.message
          : 'Erreur lors du chargement des photos.'
      );
    }
  };

  const filtered = useMemo(
    () =>
      packages.filter((pkg) =>
        [
          pkg.packingNumber,
          pkg.customerName,
          pkg.customerPhone,
          pkg.description,
          pkg.currentStatus,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [packages, query]
  );

  const getCargoAmounts = (pkg: CargoPackage) => {
    const totalValue = Number(pkg.totalAmountUSD);
    const total = Number.isFinite(totalValue)
      ? Math.max(0, totalValue)
      : 0;

    const paymentsTotal = Array.isArray(pkg.payments)
      ? pkg.payments.reduce((sum, payment) => {
          const amount = Number(payment.amountUSD);
          return sum + (
            Number.isFinite(amount) && amount > 0 ? amount : 0
          );
        }, 0)
      : 0;

    const storedPaid = Number(pkg.amountPaidUSD);
    const paidValue = paymentsTotal > 0
      ? paymentsTotal
      : Number.isFinite(storedPaid) && storedPaid > 0
        ? storedPaid
        : 0;

    // Le solde enregistré par le registre Cargo est la référence.
    // Certains anciens paiements contiennent amountUSD en FC (données historiques) :
    // les additionner directement comme des USD gonfle artificiellement le montant encaissé.
    const storedBalance = Number(pkg.remainingBalanceUSD);
    const hasValidStoredBalance =
      Number.isFinite(storedBalance) && storedBalance >= 0;

    const balance = hasValidStoredBalance
      ? Math.min(total, Math.round(storedBalance * 100) / 100)
      : Math.round(Math.max(0, total - Math.min(total, paidValue)) * 100) / 100;

    const paid = Math.round(Math.max(0, total - balance) * 100) / 100;

    return {
      total,
      paid,
      balance,
    };
  };

  const total = packages.reduce(
    (sum, pkg) => sum + getCargoAmounts(pkg).total, 0
  );

  const paid = packages.reduce(
    (sum, pkg) => sum + getCargoAmounts(pkg).paid, 0
  );

  const balance = Math.max(0, total - paid);
  const set = (key: keyof typeof form, value: string) =>
    setForm((old) => ({ ...old, [key]: value }));

  const billingQuantity =
    form.transportMode === 'AIR'
      ? Number(form.weightKg)
      : Number(form.volumeCbm);

  const unitPrice = Number(form.unitPriceUSD);

  const calculatedTotalUSD =
    Number.isFinite(billingQuantity) && Number.isFinite(unitPrice)
      ? Math.round(billingQuantity * unitPrice * 100) / 100
      : 0;

  const createPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      if (!form.packingNumber.trim()) {
        throw new Error(
          'Le numéro PKG fourni par le fournisseur est obligatoire.'
        );
      }

      await onSavePackage({
        ...form,
        packingNumber: form.packingNumber.trim(),
        photos: photoFiles,
        piecesCount: Number(form.piecesCount),
        weightKg: Number(form.weightKg),
        volumeCbm: Number(form.volumeCbm),
        unitPriceUSD: Number(form.unitPriceUSD),
        totalAmountUSD: calculatedTotalUSD,
        initialCostUSD: 0,
        transportFeeUSD: 0,
        customsFeeUSD: 0,
        extraFeeUSD: 0,
        expectedShippingDate: form.expectedShippingDate || undefined,
      });

      setForm({
        packingNumber: '',
        customerName: '',
        customerPhone: '',
        supplierName: '',
        description: '',
        originCountry: 'Chine',
        originCity: '',
        destinationCountry: 'RDC',
        destinationCity: 'Bunia',
        transportMode: 'SEA',
        carrierName: '',
        piecesCount: '1',
        weightKg: '0',
        volumeCbm: '0',
        unitPriceUSD: '',
        expectedShippingDate: '',
      });

      setPhotoFiles([]);
      setTab('list');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’enregistrer le colis.'
      );
    } finally {
      setBusy(false);
    }
  };

  const addEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;

    setError('');
    setBusy(true);

    try {
      await onAddEvent(selected.id, eventForm);
      setSelected(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’ajouter le suivi.'
      );
    } finally {
      setBusy(false);
    }
  };

  const addPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;

    setError('');
    setBusy(true);

    try {
      await onAddPayment(selected.id, {
        amountUSD: Number(paymentForm.amountUSD),
        paymentMethod: paymentForm.paymentMethod,
        notes: paymentForm.notes,
      });

      setPaymentForm({
        amountUSD: '',
        paymentMethod: 'CASH',
        notes: '',
      });

      setSelected(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’enregistrer le paiement.'
      );
    } finally {
      setBusy(false);
    }
  };

  const deletePackage = async (pkg: CargoPackage) => {
    const confirmed = window.confirm(
      `Voulez-vous vraiment supprimer définitivement le colis ${pkg.packingNumber} de ${pkg.customerName} ?`
    );

    if (!confirmed) return;

    setError('');
    setBusy(true);

    try {
      await onDeletePackage(pkg.id);
      setSelected(null);
      window.alert('Colis supprimé avec succès.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de supprimer le colis.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <header className="rounded-3xl bg-gradient-to-r from-indigo-700 to-blue-600 p-5 text-white shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-100">
              CHIEF ALPHONS COMPANY LTD
            </p>
            <h2 className="mt-1 text-xl font-black">
              Chief Cargo & Suivi Colis
            </h2>
            <p className="mt-1 text-xs text-indigo-100">
              Gestion des expéditions internationales
            </p>
          </div>
          <span className="rounded-2xl bg-white/15 p-3 text-2xl">
            🚚
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/10 p-2">
            <div className="text-lg font-bold">{packages.length}</div>
            <div className="text-[10px] text-indigo-100">Colis</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <div className="text-sm font-bold">{money(paid)}</div>
            <div className="text-[10px] text-indigo-100">Encaissé</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <div className="text-sm font-bold">{money(balance)}</div>
            <div className="text-[10px] text-indigo-100">À recevoir</div>
          </div>
        </div>
      </header>

      <nav className="grid grid-cols-3 gap-2">
        {(['dashboard', 'list', 'new'] as const).map((item) => (
          <button
            key={item}
            onClick={() => {
              setTab(item);
              setSelected(null);
              setError('');
            }}
            className={`rounded-xl px-3 py-3 text-xs font-bold ${
              tab === item
                ? 'bg-indigo-600 text-white'
                : 'border border-slate-200 bg-white text-slate-600'
            }`}
          >
            {item === 'dashboard'
              ? 'Vue générale'
              : item === 'list'
                ? 'Mes colis'
                : '+ Nouveau colis'}
          </button>
        ))}
      </nav>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {tab === 'dashboard' && (
        <section className="grid gap-3 sm:grid-cols-2">
          {[
            ['Valeur totale facturée', money(total)],
            ['Montant encaissé', money(paid)],
            ['Solde restant', money(balance)],
            [
              'Colis en cours',
              String(
                packages.filter((p) => p.currentStatus !== 'DELIVERED')
                  .length
              ),
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-extrabold text-slate-900">
                {value}
              </p>
            </div>
          ))}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
            <h3 className="font-bold text-slate-800">
              Activité récente
            </h3>

            {packages.slice(0, 5).length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                Aucun colis enregistré.
              </p>
            ) : (
              packages.slice(0, 5).map((pkg) => (
                <button
                  key={pkg.id}
                  onClick={() => {
                    setSelected(pkg);
                    setTab('list');
                  }}
                  className="flex w-full items-center justify-between border-b border-slate-100 py-3 text-left last:border-0"
                >
                  <span>
                    <b className="block text-sm">
                      {pkg.packingNumber} · {pkg.customerName}
                    </b>
                    <small className="text-slate-500">
                      {statusLabel(pkg.currentStatus)}
                    </small>
                  </span>
                  <b className="text-sm">
                    {money(getCargoAmounts(pkg).total)}
                  </b>
                </button>
              ))
            )}
          </div>
        </section>
      )}

      {tab === 'list' && (
        <section className="space-y-3">
          <input
            className={field}
            placeholder="Rechercher référence, client, téléphone..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              Aucun colis trouvé.
            </div>
          ) : (
            filtered.map((pkg) => (
              <article
                key={pkg.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <button
                  className="w-full text-left"
                  onClick={() =>
                    setSelected(
                      selected?.id === pkg.id ? null : pkg
                    )
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-indigo-600">
                        {pkg.packingNumber}
                      </p>
                      <h3 className="mt-1 font-bold text-slate-900">
                        {pkg.customerName}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {pkg.description}
                      </p>
                    </div>
                    <span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">
                      {statusLabel(pkg.currentStatus)}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400">Total</span>
                      <b className="block">
                        {money(pkg.totalAmountUSD)}
                      </b>
                    </div>
                    <div>
                      <span className="text-slate-400">Payé</span>
                      <b className="block">
                        {money(getCargoAmounts(pkg).paid)}
                      </b>
                    </div>
                    <div>
                      <span className="text-slate-400">Solde</span>
                      <b className="block text-amber-700">
                        {money(getCargoAmounts(pkg).balance)}
                      </b>
                    </div>
                  </div>
                </button>

                {selected?.id === pkg.id && (
                  <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                    {!!pkg.photos?.length && (
                      <div>
                        <h4 className="mb-2 text-sm font-bold">
                          Photos du colis
                        </h4>
                        <div className="grid grid-cols-3 gap-2">
                          {pkg.photos.map((photo, index) => (
                            <a
                              key={index}
                              href={photo}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img
                                src={photo}
                                alt={`Photo du colis ${index + 1}`}
                                className="h-24 w-full rounded-xl border border-slate-200 object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <p>
                        Transport :{' '}
                        <b>
                          {pkg.transportMode === 'AIR'
                            ? 'Aérien'
                            : 'Maritime'}
                        </b>
                      </p>
                      <p>
                        Pièces : <b>{pkg.piecesCount}</b>
                      </p>
                      <p>
                        Poids : <b>{pkg.weightKg} kg</b>
                      </p>
                      <p>
                        Volume : <b>{pkg.volumeCbm} CBM</b>
                      </p>
                      {pkg.unitPriceUSD !== undefined && (
                        <p>
                          Prix unitaire :{' '}
                          <b>
                            {money(pkg.unitPriceUSD)} /{' '}
                            {pkg.transportMode === 'AIR' ? 'kg' : 'CBM'}
                          </b>
                        </p>
                      )}
                      <p>
                        Origine :{' '}
                        <b>
                          {pkg.originCity}, {pkg.originCountry}
                        </b>
                      </p>
                      <p>
                        Destination :{' '}
                        <b>
                          {pkg.destinationCity}, {pkg.destinationCountry}
                        </b>
                      </p>
                    </div>

                    <form
                      onSubmit={addEvent}
                      className="space-y-2 rounded-xl bg-slate-50 p-3"
                    >
                      <h4 className="text-sm font-bold">
                        Ajouter une étape de suivi
                      </h4>

                      <select
                        className={field}
                        value={eventForm.status}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            status: e.target.value as CargoStatus,
                          })
                        }
                      >
                        {STATUS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className={field}
                          placeholder="Pays"
                          value={eventForm.country}
                          onChange={(e) =>
                            setEventForm({
                              ...eventForm,
                              country: e.target.value,
                            })
                          }
                        />
                        <input
                          className={field}
                          placeholder="Ville"
                          value={eventForm.city}
                          onChange={(e) =>
                            setEventForm({
                              ...eventForm,
                              city: e.target.value,
                            })
                          }
                        />
                      </div>

                      <input
                        className={field}
                        placeholder="Lieu précis (facultatif)"
                        value={eventForm.location}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            location: e.target.value,
                          })
                        }
                      />

                      <input
                        className={field}
                        placeholder="Commentaire"
                        value={eventForm.comment}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            comment: e.target.value,
                          })
                        }
                      />

                      <button
                        disabled={busy}
                        className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busy ? 'Enregistrement...' : 'Enregistrer le suivi'}
                      </button>
                    </form>

                    <form
                      onSubmit={addPayment}
                      className="space-y-2 rounded-xl bg-emerald-50 p-3"
                    >
                      <h4 className="text-sm font-bold">
                        Enregistrer un paiement (USD)
                      </h4>

                      <input
                        className={field}
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={pkg.remainingBalanceUSD}
                        placeholder={`Montant USD (solde ${pkg.remainingBalanceUSD})`}
                        value={paymentForm.amountUSD}
                        onChange={(e) =>
                          setPaymentForm({
                            ...paymentForm,
                            amountUSD: e.target.value,
                          })
                        }
                        required
                      />

                      <select
                        className={field}
                        value={paymentForm.paymentMethod}
                        onChange={(e) =>
                          setPaymentForm({
                            ...paymentForm,
                            paymentMethod: e.target.value as PaymentMethod,
                          })
                        }
                      >
                        <option value="CASH">Espèces</option>
                        <option value="MOBILE_MONEY">Mobile Money</option>
                        <option value="BANK_TRANSFER">Virement bancaire</option>
                      </select>

                      <input
                        className={field}
                        placeholder="Note (facultatif)"
                        value={paymentForm.notes}
                        onChange={(e) =>
                          setPaymentForm({
                            ...paymentForm,
                            notes: e.target.value,
                          })
                        }
                      />

                      <button
                        disabled={
                          busy || pkg.remainingBalanceUSD <= 0
                        }
                        className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busy
                          ? 'Enregistrement...'
                          : 'Valider le paiement'}
                      </button>
                    </form>

                    <div>
                      <h4 className="text-sm font-bold">
                        Historique des étapes
                      </h4>

                      {(pkg.events || []).length === 0 ? (
                        <p className="mt-2 text-xs text-slate-400">
                          Aucun événement enregistré.
                        </p>
                      ) : (
                        [...pkg.events].reverse().map((ev) => (
                          <div
                            key={ev.id}
                            className="border-l-2 border-indigo-200 py-2 pl-3"
                          >
                            <b className="text-xs">
                              {statusLabel(ev.status)}
                            </b>
                            <p className="text-xs text-slate-500">
                              {ev.city}, {ev.country} ·{' '}
                              {new Date(ev.date).toLocaleString()}
                            </p>
                            {ev.comment && (
                              <p className="text-xs">{ev.comment}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-bold">Paiements</h4>
                      {(pkg.payments || []).map((payment) => (
                        <p
                          key={payment.id}
                          className="flex justify-between border-b border-slate-100 py-2 text-xs"
                        >
                          <span>
                            {new Date(payment.date).toLocaleDateString()} ·{' '}
                            {payment.receiptNumber}
                          </span>
                          <b>{money(payment.amountUSD)}</b>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => deletePackage(pkg)}
                  className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  {busy
                    ? 'Suppression en cours...'
                    : 'Supprimer définitivement ce colis'}
                </button>
              </article>
            ))
          )}
        </section>
      )}

      {tab === 'new' && (
        <form
          onSubmit={createPackage}
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
        >
          <h3 className="font-bold text-slate-900">
            Enregistrer un nouveau colis
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Numéro PKG du fournisseur
              <input
                className={field}
                value={form.packingNumber}
                onChange={(e) => set('packingNumber', e.target.value)}
                placeholder="Ex. PKG écrit sur le colis"
                required
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Nom du client
              <input
                className={field}
                value={form.customerName}
                onChange={(e) => set('customerName', e.target.value)}
                required
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Téléphone
              <input
                className={field}
                value={form.customerPhone}
                onChange={(e) => set('customerPhone', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Fournisseur
              <input
                className={field}
                value={form.supplierName}
                onChange={(e) => set('supplierName', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Transport
              <select
                className={field}
                value={form.transportMode}
                onChange={(e) => set('transportMode', e.target.value)}
              >
                <option value="SEA">Maritime</option>
                <option value="AIR">Aérien</option>
              </select>
            </label>
          </div>

          <label className="block text-xs font-semibold text-slate-600">
            Description du colis
            <input
              className={field}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              required
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600">
              Pays d'origine
              <input
                className={field}
                value={form.originCountry}
                onChange={(e) => set('originCountry', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Ville d'origine
              <input
                className={field}
                value={form.originCity}
                onChange={(e) => set('originCity', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Pays destination
              <input
                className={field}
                value={form.destinationCountry}
                onChange={(e) => set('destinationCountry', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Ville destination
              <input
                className={field}
                value={form.destinationCity}
                onChange={(e) => set('destinationCity', e.target.value)}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-600">
              Nombre de pièces
              <input
                className={field}
                type="number"
                min="1"
                step="1"
                value={form.piecesCount}
                onChange={(e) => set('piecesCount', e.target.value)}
                required
              />
            </label>

            {form.transportMode === 'AIR' ? (
              <label className="text-xs text-slate-600">
                Poids facturable (kg)
                <input
                  className={field}
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex. 0.1224"
                  value={form.weightKg}
                  onChange={(e) =>
                    set(
                      'weightKg',
                      e.target.value.replace(',', '.').replace(/[^0-9.]/g, '')
                    )
                  }
                  required
                />
              </label>
            ) : (
              <label className="text-xs text-slate-600">
                Volume facturable (CBM/KG)
                <input
                  className={field}
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex. 0.1224"
                  value={form.volumeCbm}
                  onChange={(e) =>
                    set(
                      'volumeCbm',
                      e.target.value.replace(',', '.').replace(/[^0-9.]/g, '')
                    )
                  }
                  required
                />
              </label>
            )}
          </div>

          <section className="space-y-2 rounded-xl border border-slate-200 p-3">
            <h4 className="text-sm font-bold">Photos du colis</h4>
            <p className="text-xs text-slate-500">
              Prenez une photo avec le téléphone ou choisissez des images dans
              la galerie (6 maximum).
            </p>

            <input
              className={field}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => {
                void handlePhotos(e.target.files);
                e.currentTarget.value = '';
              }}
            />

            {photoError && (
              <p className="text-xs text-red-600">{photoError}</p>
            )}

            {photoFiles.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photoFiles.map((photo, index) => (
                  <div key={index} className="relative">
                    <img
                      src={photo}
                      alt={`Aperçu ${index + 1}`}
                      className="h-24 w-full rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPhotoFiles((old) =>
                          old.filter((_, i) => i !== index)
                        )
                      }
                      className="absolute right-1 top-1 rounded-full bg-red-600 px-2 py-1 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
            <h4 className="text-sm font-bold text-indigo-900">
              Facturation automatique (USD)
            </h4>

            <label className="block text-xs font-semibold text-indigo-900">
              Prix unitaire (
              {form.transportMode === 'AIR'
                ? 'USD par kg'
                : 'USD par CBM'}
              )
              <input
                className={field}
                type="number"
                min="0.01"
                step="0.01"
                value={form.unitPriceUSD}
                onChange={(e) => set('unitPriceUSD', e.target.value)}
                placeholder={
                  form.transportMode === 'AIR'
                    ? 'Ex. 8.00 USD/kg'
                    : 'Ex. 120.00 USD/CBM'
                }
                required
              />
            </label>

            <p className="text-xs text-indigo-800">
              Calcul :{' '}
              {form.transportMode === 'AIR'
                ? `${form.weightKg || 0} kg ×`
                : `${form.volumeCbm || 0} CBM ×`}{' '}
              {form.unitPriceUSD || 0} USD
            </p>

            <p className="rounded-lg bg-white p-3 text-base font-black text-indigo-900">
              Total à facturer : {money(calculatedTotalUSD)}
            </p>
          </section>

          <label className="block text-xs text-slate-600">
            Date d'expédition prévue
            <input
              className={field}
              type="date"
              value={form.expectedShippingDate}
              onChange={(e) =>
                set('expectedShippingDate', e.target.value)
              }
            />
          </label>

          <button
            disabled={busy}
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Enregistrement...' : 'Créer le colis'}
          </button>
        </form>
      )}

      <p className="text-center text-[10px] text-slate-400">
        Connecté : {currentUser.name} · Données enregistrées localement sur
        cet appareil.
      </p>
    </div>
  );
};
