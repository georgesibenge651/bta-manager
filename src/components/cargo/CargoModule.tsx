
import React, { useMemo, useState } from 'react';
import { CargoPackage, CargoStatus, User, CompanySettings, PaymentMethod } from '../../types';
import { useLanguage } from '../../i18n';

interface CargoModuleProps {
  packages: CargoPackage[];
  settings: CompanySettings;
  currentUser: User;
  onSavePackage: (pkg: Partial<CargoPackage>) => Promise<any>;
  onAddEvent: (packageId: string, event: Partial<{ status: CargoStatus; country: string; city: string; location: string; comment: string }>) => Promise<any>;
  onAddPayment: (packageId: string, payment: Partial<{ amountUSD: number; paymentMethod: PaymentMethod; notes: string }>) => Promise<any>;
  onDeletePackage: (packageId: string) => Promise<void>;
}

const STATUS: Array<{ value: CargoStatus; label: string; englishLabel: string }> = [
  { value: 'REGISTERED', label: 'Colis enregistré', englishLabel: 'Package registered' },
  { value: 'CHINA_WAREHOUSE', label: 'Entrepôt en Chine', englishLabel: 'At China warehouse' },
  { value: 'PREPARING', label: 'En préparation', englishLabel: 'Preparing' },
  { value: 'SHIPPED_CHINA', label: 'Expédié de Chine', englishLabel: 'Shipped from China' },
  { value: 'INTERNATIONAL_TRANSIT', label: 'Transit international', englishLabel: 'In international transit' },
  { value: 'TRANSIT_COUNTRY', label: 'Pays de transit', englishLabel: 'Transit country' },
  { value: 'CUSTOMS', label: 'En douane', englishLabel: 'At customs' },
  { value: 'ARRIVED_DRC', label: 'Arrivé en RDC', englishLabel: 'Arrived in the DRC' },
  { value: 'ON_WAY_BUNIA', label: 'En route vers Bunia', englishLabel: 'On the way to Bunia' },
  { value: 'ARRIVED_BUNIA', label: 'Arrivé à Bunia', englishLabel: 'Arrived in Bunia' },
  { value: 'AVAILABLE_PICKUP', label: 'Disponible au retrait', englishLabel: 'Ready for pickup' },
  { value: 'DELIVERED', label: 'Livré au client', englishLabel: 'Delivered to customer' },
];

const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value || 0);

const createPackageForm = (language: 'fr' | 'en') => ({
  packingNumber: '',
  customerName: '',
  customerPhone: '',
  supplierName: '',
  description: '',
  originCountry: language === 'en' ? 'China' : 'Chine',
  originCity: '',
  destinationCountry: language === 'en' ? 'DRC' : 'RDC',
  destinationCity: 'Bunia',
  transportMode: 'SEA' as 'AIR' | 'SEA',
  carrierName: '',
  piecesCount: '1',
  weightKg: '0',
  volumeCbm: '0',
  unitPriceUSD: '',
  expectedShippingDate: '',
});

const statusLabel = (
  status: CargoStatus,
  t: (french: string, english: string) => string,
) => {
  const item = STATUS.find((candidate) => candidate.value === status);
  return item ? t(item.label, item.englishLabel) : status;
};

const CARGO_ERROR_TRANSLATIONS: Record<string, string> = {
  'Chargement des données en cours. Réessayez après sa fin.': 'Data is still loading. Please try again when it has finished.',
  'Action réservée aux gestionnaires et administrateurs.': 'This action is restricted to managers and administrators.',
  'Colis introuvable.': 'Package not found.',
  'Le nom du client est obligatoire.': 'Customer name is required.',
  'La description du colis est obligatoire.': 'Package description is required.',
  'Le numéro PKG fourni par le fournisseur est obligatoire.': 'The PKG number provided by the supplier is required.',
  'Le numéro PKG ne peut pas dépasser 120 caractères.': 'The PKG number cannot exceed 120 characters.',
  'Ce numéro PKG est déjà associé à un autre colis.': 'This PKG number is already assigned to another package.',
  'Quantité, poids ou volume invalide.': 'Invalid quantity, weight, or volume.',
  'Un montant Cargo historique est invalide.': 'A historical Cargo amount is invalid.',
  'Le prix unitaire doit être supérieur à zéro.': 'The unit price must be greater than zero.',
  'Le poids en kilogrammes doit être supérieur à zéro.': 'The weight in kilograms must be greater than zero.',
  'Le volume en CBM doit être supérieur à zéro.': 'The volume in CBM must be greater than zero.',
  'Le prix unitaire de facturation est obligatoire.': 'The billing unit price is required.',
  'Sélectionnez le nouveau statut du colis.': 'Select the new package status.',
  'Le montant du paiement doit être supérieur à zéro.': 'The payment amount must be greater than zero.',
  'Le paiement dépasse le solde restant.': 'The payment exceeds the remaining balance.',
};

const cargoErrorMessage = (
  error: unknown,
  t: (french: string, english: string) => string,
  fallbackFrench: string,
  fallbackEnglish: string,
) => {
  if (!(error instanceof Error)) return t(fallbackFrench, fallbackEnglish);

  const permissionPrefix = 'Permission Core refusée pour cet établissement: ';
  if (error.message.startsWith(permissionPrefix)) {
    const permission = error.message.slice(permissionPrefix.length);
    return t(error.message, `Core permission denied for this location: ${permission}`);
  }

  return t(error.message, CARGO_ERROR_TRANSLATIONS[error.message] || error.message);
};

const field =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500';

export const CargoModule: React.FC<CargoModuleProps> = ({
  packages,
  settings,
  currentUser,
  onSavePackage,
  onAddEvent,
  onAddPayment,
  onDeletePackage,
}) => {
  const { language, t } = useLanguage();
  const [tab, setTab] = useState<'dashboard' | 'list' | 'new'>('dashboard');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CargoPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState(() => createPackageForm(language));

  const [eventForm, setEventForm] = useState({
    status: 'CHINA_WAREHOUSE' as CargoStatus,
    country: language === 'en' ? 'DRC' : 'RDC',
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
        reject(new Error(t('Lecture de la photo impossible.', 'Unable to read the photo.')));

      reader.onload = () => {
        const img = new Image();

        img.onerror = () =>
          reject(new Error(t('Format de photo non reconnu.', 'Unrecognized photo format.')));

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
            return reject(new Error(t('Compression photo indisponible.', 'Photo compression is unavailable.')));
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
        throw new Error(t('Sélectionnez uniquement des images.', 'Select image files only.'));
      }

      const converted = await Promise.all(selectedFiles.map(readPhoto));

      if (photoFiles.length + converted.length > 6) {
        throw new Error(t('Maximum 6 photos par colis.', 'You can add up to 6 photos per package.'));
      }

      setPhotoFiles((old) => [...old, ...converted]);
    } catch (err) {
      setPhotoError(
        err instanceof Error
          ? err.message
          : t('Erreur lors du chargement des photos.', 'Unable to load the photos.')
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
        throw new Error('Le numéro PKG fourni par le fournisseur est obligatoire.');
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

      setForm(createPackageForm(language));

      setPhotoFiles([]);
      setTab('list');
    } catch (err) {
      setError(cargoErrorMessage(err, t, 'Impossible d’enregistrer le colis.', 'Unable to save the package.'));
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
      setError(cargoErrorMessage(err, t, 'Impossible d’ajouter le suivi.', 'Unable to add the tracking update.'));
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
      setError(cargoErrorMessage(err, t, 'Impossible d’enregistrer le paiement.', 'Unable to record the payment.'));
    } finally {
      setBusy(false);
    }
  };

  const deletePackage = async (pkg: CargoPackage) => {
    const confirmed = window.confirm(
      t(
        `Voulez-vous vraiment supprimer définitivement le colis ${pkg.packingNumber} de ${pkg.customerName} ?`,
        `Are you sure you want to permanently delete package ${pkg.packingNumber} for ${pkg.customerName}?`,
      )
    );

    if (!confirmed) return;

    setError('');
    setBusy(true);

    try {
      await onDeletePackage(pkg.id);
      setSelected(null);
      window.alert(t('Colis supprimé avec succès.', 'Package deleted successfully.'));
    } catch (err) {
      setError(cargoErrorMessage(err, t, 'Impossible de supprimer le colis.', 'Unable to delete the package.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <header className="rounded-3xl bg-gradient-to-r from-amber-700 to-amber-600 p-5 text-white shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-100">
              CHIEF ALPHONS COMPANY LTD
            </p>
            <h2 className="mt-1 text-xl font-black">
              {t('Chief Cargo & Suivi Colis', 'Chief Cargo & Parcel Tracking')}
            </h2>
            <p className="mt-1 text-xs text-amber-100">
              {t('Gestion des expéditions internationales', 'International shipment management')}
            </p>
          </div>
          <span className="rounded-2xl bg-white/15 p-3 text-2xl">
            🚚
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/10 p-2">
            <div className="text-lg font-bold">{packages.length}</div>
            <div className="text-[10px] text-amber-100">{t('Colis', 'Packages')}</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <div className="text-sm font-bold">{money(paid)}</div>
            <div className="text-[10px] text-amber-100">{t('Encaissé', 'Received')}</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <div className="text-sm font-bold">{money(balance)}</div>
            <div className="text-[10px] text-amber-100">{t('À recevoir', 'Due')}</div>
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
                ? 'bg-amber-600 text-white'
                : 'border border-slate-200 bg-white text-slate-600'
            }`}
          >
            {item === 'dashboard'
              ? t('Vue générale', 'Dashboard')
              : item === 'list'
                ? t('Mes colis', 'My packages')
                : t('+ Nouveau colis', '+ New package')}
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
            [t('Valeur totale facturée', 'Total value billed'), money(total)],
            [t('Montant encaissé', 'Amount received'), money(paid)],
            [t('Solde restant', 'Remaining balance'), money(balance)],
            [
              t('Colis en cours', 'In-transit packages'),
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
              {t('Activité récente', 'Recent activity')}
            </h3>

            {packages.slice(0, 5).length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                {t('Aucun colis enregistré.', 'No packages have been registered.')}
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
                      {statusLabel(pkg.currentStatus, t)}
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
            placeholder={t('Rechercher référence, client, téléphone...', 'Search reference, customer, or phone...')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              {t('Aucun colis trouvé.', 'No packages found.')}
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
                      <p className="text-xs font-bold text-amber-600">
                        {pkg.packingNumber}
                      </p>
                      <h3 className="mt-1 font-bold text-slate-900">
                        {pkg.customerName}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {pkg.description}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                      {statusLabel(pkg.currentStatus, t)}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400">{t('Total', 'Total')}</span>
                      <b className="block">
                        {money(pkg.totalAmountUSD)}
                      </b>
                    </div>
                    <div>
                      <span className="text-slate-400">{t('Payé', 'Paid')}</span>
                      <b className="block">
                        {money(getCargoAmounts(pkg).paid)}
                      </b>
                    </div>
                    <div>
                      <span className="text-slate-400">{t('Solde', 'Balance')}</span>
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
                          {t('Photos du colis', 'Package photos')}
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
                                alt={t(`Photo du colis ${index + 1}`, `Package photo ${index + 1}`)}
                                className="h-24 w-full rounded-xl border border-slate-200 object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <p>
                        {t('Transport :', 'Transport:')}{' '}
                        <b>
                          {pkg.transportMode === 'AIR'
                            ? t('Aérien', 'Air')
                            : t('Maritime', 'Sea')}
                        </b>
                      </p>
                      <p>
                        {t('Pièces :', 'Pieces:')} <b>{pkg.piecesCount}</b>
                      </p>
                      <p>
                        {t('Poids :', 'Weight:')} <b>{pkg.weightKg} kg</b>
                      </p>
                      <p>
                        {t('Volume :', 'Volume:')} <b>{pkg.volumeCbm} CBM</b>
                      </p>
                      {pkg.unitPriceUSD !== undefined && (
                        <p>
                          {t('Prix unitaire :', 'Unit price:')}{' '}
                          <b>
                            {money(pkg.unitPriceUSD)} /{' '}
                            {pkg.transportMode === 'AIR' ? 'kg' : 'CBM'}
                          </b>
                        </p>
                      )}
                      <p>
                        {t('Origine :', 'Origin:')}{' '}
                        <b>
                          {pkg.originCity}, {pkg.originCountry}
                        </b>
                      </p>
                      <p>
                        {t('Destination :', 'Destination:')}{' '}
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
                        {t('Ajouter une étape de suivi', 'Add a tracking update')}
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
                            {t(s.label, s.englishLabel)}
                          </option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className={field}
                          placeholder={t('Pays', 'Country')}
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
                          placeholder={t('Ville', 'City')}
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
                        placeholder={t('Lieu précis (facultatif)', 'Specific location (optional)')}
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
                        placeholder={t('Commentaire', 'Comment')}
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
                        className="w-full rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busy ? t('Enregistrement...', 'Saving...') : t('Enregistrer le suivi', 'Save tracking update')}
                      </button>
                    </form>

                    <form
                      onSubmit={addPayment}
                      className="space-y-2 rounded-xl bg-emerald-50 p-3"
                    >
                      <h4 className="text-sm font-bold">
                        {t('Enregistrer un paiement (USD)', 'Record a payment (USD)')}
                      </h4>

                      <input
                        className={field}
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={pkg.remainingBalanceUSD}
                        placeholder={t(`Montant USD (solde ${pkg.remainingBalanceUSD})`, `Amount in USD (balance ${pkg.remainingBalanceUSD})`)}
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
                        <option value="CASH">{t('Espèces', 'Cash')}</option>
                        <option value="MOBILE_MONEY">Mobile Money</option>
                        <option value="BANK_TRANSFER">{t('Virement bancaire', 'Bank transfer')}</option>
                      </select>

                      <input
                        className={field}
                        placeholder={t('Note (facultatif)', 'Note (optional)')}
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
                          ? t('Enregistrement...', 'Saving...')
                          : t('Valider le paiement', 'Submit payment')}
                      </button>
                    </form>

                    <div>
                      <h4 className="text-sm font-bold">
                        {t('Historique des étapes', 'Tracking history')}
                      </h4>

                      {(pkg.events || []).length === 0 ? (
                        <p className="mt-2 text-xs text-slate-400">
                          {t('Aucun événement enregistré.', 'No tracking events recorded.')}
                        </p>
                      ) : (
                        [...pkg.events].reverse().map((ev) => (
                          <div
                            key={ev.id}
                            className="border-l-2 border-amber-200 py-2 pl-3"
                          >
                            <b className="text-xs">
                              {statusLabel(ev.status, t)}
                            </b>
                            <p className="text-xs text-slate-500">
                              {ev.city}, {ev.country} ·{' '}
                              {new Date(ev.date).toLocaleString(language === 'en' ? 'en-US' : 'fr-FR')}
                            </p>
                            {ev.comment && (
                              <p className="text-xs">{ev.comment}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-bold">{t('Paiements', 'Payments')}</h4>
                      {(pkg.payments || []).map((payment) => (
                        <p
                          key={payment.id}
                          className="flex justify-between border-b border-slate-100 py-2 text-xs"
                        >
                          <span>
                            {new Date(payment.date).toLocaleDateString(language === 'en' ? 'en-US' : 'fr-FR')} ·{' '}
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
                    ? t('Suppression en cours...', 'Deleting...')
                    : t('Supprimer définitivement ce colis', 'Permanently delete this package')}
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
            {t('Enregistrer un nouveau colis', 'Register a new package')}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              {t('Numéro PKG du fournisseur', 'Supplier PKG number')}
              <input
                className={field}
                value={form.packingNumber}
                onChange={(e) => set('packingNumber', e.target.value)}
                placeholder={t('Ex. PKG écrit sur le colis', 'e.g. PKG number printed on the package')}
                required
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              {t('Nom du client', 'Customer name')}
              <input
                className={field}
                value={form.customerName}
                onChange={(e) => set('customerName', e.target.value)}
                required
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              {t('Téléphone', 'Phone')}
              <input
                className={field}
                value={form.customerPhone}
                onChange={(e) => set('customerPhone', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              {t('Fournisseur', 'Supplier')}
              <input
                className={field}
                value={form.supplierName}
                onChange={(e) => set('supplierName', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              {t('Transport', 'Transport')}
              <select
                className={field}
                value={form.transportMode}
                onChange={(e) => set('transportMode', e.target.value)}
              >
                <option value="SEA">{t('Maritime', 'Sea')}</option>
                <option value="AIR">{t('Aérien', 'Air')}</option>
              </select>
            </label>
          </div>

          <label className="block text-xs font-semibold text-slate-600">
            {t('Description du colis', 'Package description')}
            <input
              className={field}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              required
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600">
              {t("Pays d'origine", 'Origin country')}
              <input
                className={field}
                value={form.originCountry}
                onChange={(e) => set('originCountry', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              {t("Ville d'origine", 'Origin city')}
              <input
                className={field}
                value={form.originCity}
                onChange={(e) => set('originCity', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              {t('Pays destination', 'Destination country')}
              <input
                className={field}
                value={form.destinationCountry}
                onChange={(e) => set('destinationCountry', e.target.value)}
              />
            </label>

            <label className="text-xs font-semibold text-slate-600">
              {t('Ville destination', 'Destination city')}
              <input
                className={field}
                value={form.destinationCity}
                onChange={(e) => set('destinationCity', e.target.value)}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-600">
              {t('Nombre de pièces', 'Number of pieces')}
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
                {t('Poids facturable (kg)', 'Chargeable weight (kg)')}
                <input
                  className={field}
                  type="text"
                  inputMode="decimal"
                  placeholder={t('Ex. 0.1224', 'e.g. 0.1224')}
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
                {t('Volume facturable (CBM/KG)', 'Chargeable volume (CBM/KG)')}
                <input
                  className={field}
                  type="text"
                  inputMode="decimal"
                  placeholder={t('Ex. 0.1224', 'e.g. 0.1224')}
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
            <h4 className="text-sm font-bold">{t('Photos du colis', 'Package photos')}</h4>
            <p className="text-xs text-slate-500">
              {t(
                'Prenez une photo avec le téléphone ou choisissez des images dans la galerie (6 maximum).',
                'Take a photo with your phone or choose images from the gallery (up to 6).',
              )}
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
                      alt={t(`Aperçu ${index + 1}`, `Preview ${index + 1}`)}
                      className="h-24 w-full rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPhotoFiles((old) =>
                          old.filter((_, i) => i !== index)
                        )
                      }
                      aria-label={t('Supprimer la photo', 'Remove photo')}
                      className="absolute right-1 top-1 rounded-full bg-red-600 px-2 py-1 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2 rounded-xl border border-amber-100 bg-amber-50 p-3">
            <h4 className="text-sm font-bold text-amber-900">
              {t('Facturation automatique (USD)', 'Automatic billing (USD)')}
            </h4>

            <label className="block text-xs font-semibold text-amber-900">
              {t('Prix unitaire (', 'Unit price (')}
              {form.transportMode === 'AIR'
                ? t('USD par kg', 'USD per kg')
                : t('USD par CBM', 'USD per CBM')}
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
                    ? t('Ex. 8.00 USD/kg', 'e.g. 8.00 USD/kg')
                    : t('Ex. 120.00 USD/CBM', 'e.g. 120.00 USD/CBM')
                }
                required
              />
            </label>

            <p className="text-xs text-amber-800">
              {t('Calcul :', 'Calculation:')}{' '}
              {form.transportMode === 'AIR'
                ? `${form.weightKg || 0} kg ×`
                : `${form.volumeCbm || 0} CBM ×`}{' '}
              {form.unitPriceUSD || 0} USD
            </p>

            <p className="rounded-lg bg-white p-3 text-base font-black text-amber-900">
              {t('Total à facturer :', 'Total to bill:')} {money(calculatedTotalUSD)}
            </p>
          </section>

          <label className="block text-xs text-slate-600">
            {t("Date d'expédition prévue", 'Expected shipping date')}
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
            className="w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? t('Enregistrement...', 'Saving...') : t('Créer le colis', 'Create package')}
          </button>
        </form>
      )}

      <p className="text-center text-[10px] text-slate-400">
        {t('Connecté :', 'Signed in:')} {currentUser.name} ·{' '}
        {t('Données enregistrées localement sur cet appareil.', 'Data is saved locally on this device.')}
      </p>
    </div>
  );
};
