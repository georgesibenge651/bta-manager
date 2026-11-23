import React, { useEffect, useMemo, useState } from 'react';
import { appRepository } from '../../db/storage';
import type { ImportShipment, ImportShipmentStatus } from '../../types';
import { Package, Plus, Search, Camera, Trash2, Save, X, RefreshCw } from 'lucide-react';

const STATUSES: ImportShipmentStatus[] = [
  'Préparation fournisseur',
  'Expédié',
  'Arrivé en Tanzanie',
  'En attente de transport',
  'En transit vers Bunia',
  'Arrivé à Bunia',
  'Réceptionné / Clôturé',
];

const today = () => new Date().toISOString().slice(0, 10);
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const readPhoto = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error(`Impossible de lire ${file.name}`));
  reader.readAsDataURL(file);
});

const ImportExportModule: React.FC = () => {
  const [shipments, setShipments] = useState<ImportShipment[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [form, setForm] = useState({ trackingNumber: '', description: '', weight: '', volume: '', transportMode: 'Aérien' as ImportShipment['transportMode'] });

  const refresh = () => setShipments(appRepository.getImportExportData().shipments);
  useEffect(() => {
    refresh();
    return appRepository.subscribe(refresh);
  }, []);

  const filteredShipments = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    if (!q) return shipments;
    return shipments.filter(item => (item.trackingNumber || '').toLocaleLowerCase().includes(q));
  }, [shipments, search]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  };

  const resetForm = () => {
    setForm({ trackingNumber: '', description: '', weight: '', volume: '', transportMode: 'Aérien' });
    setPhotos([]);
    setShowForm(false);
  };

  const saveShipment = async () => {
    if (!form.trackingNumber.trim() || !form.description.trim()) {
      notify('Le numéro tracking et la désignation sont obligatoires.');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const trackingNumber = form.trackingNumber.trim();
      const shipment: ImportShipment = {
        id: uid(),
        trackingNumber,
        reference: trackingNumber,
        customer: '',
        customerPhone: '',
        supplierId: '',
        description: form.description.trim(),
        quantity: 1,
        weight: Number(form.weight) || 0,
        volume: Number(form.volume) || 0,
        origin: '',
        destination: 'Bunia, RDC',
        transportMode: form.transportMode,
        status: STATUSES[0],
        departureDate: today(),
        expectedDate: '',
        notes: '',
        createdAt: now,
        updatedAt: now,
        transportPriceUSD: 0,
        photos,
        documents: [],
      };
      appRepository.saveImportExportRecord('shipment', shipment as unknown as Record<string, unknown>);
      appRepository.saveImportExportRecord('tracking', {
        id: uid(), shipmentId: shipment.id, status: STATUSES[0], date: today(),
        country: '', city: '', location: 'Enregistrement', observation: 'Colis enregistré',
      });
      refresh();
      resetForm();
      notify('Colis enregistré avec succès.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Erreur lors de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = (shipment: ImportShipment, status: ImportShipmentStatus) => {
    const updated = { ...shipment, status, updatedAt: new Date().toISOString() };
    appRepository.saveImportExportRecord('shipment', updated as unknown as Record<string, unknown>);
    appRepository.saveImportExportRecord('tracking', {
      id: uid(), shipmentId: shipment.id, status, date: today(), country: '', city: '',
      location: '', observation: `Statut modifié : ${status}`,
    });
    refresh();
  };

  const handlePhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const selected = await Promise.all(Array.from(files).map(readPhoto));
      setPhotos(current => [...current, ...selected]);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Erreur de lecture des photos.');
    }
  };

  return (
    <div className="space-y-5 bg-slate-50 p-4 text-slate-900 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Import-Export</h2>
          <p className="text-sm !text-slate-500">Enregistrement et suivi simplifié des colis</p>
        </div>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-white hover:bg-amber-700">
          <Plus size={18} /> Nouveau colis
        </button>
      </div>

      {notice && <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>}

      {showForm && (
        <section className="rounded-xl border border-slate-200 !bg-white p-4 !text-slate-900 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Enregistrer un colis</h3>
            <button onClick={resetForm} aria-label="Fermer" className="rounded p-1 hover:bg-gray-100"><X size={20} /></button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm !text-slate-800">Numéro tracking *
              <input value={form.trackingNumber} onChange={e => setForm(v => ({ ...v, trackingNumber: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 !bg-white px-3 py-2 !text-slate-900 placeholder:!text-slate-400" placeholder="Ex. ABC123456789" />
            </label>
            <label className="text-sm !text-slate-800">Désignation du colis *
              <input value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 !bg-white px-3 py-2 !text-slate-900 placeholder:!text-slate-400" placeholder="Description de la marchandise" />
            </label>
            <label className="text-sm !text-slate-800">Poids (kg)
              <input type="number" min="0" step="0.01" value={form.weight} onChange={e => setForm(v => ({ ...v, weight: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 !bg-white px-3 py-2 !text-slate-900 placeholder:!text-slate-400" placeholder="0" />
            </label>
            <label className="text-sm !text-slate-800">Volume (CBM)
              <input type="number" min="0" step="0.001" value={form.volume} onChange={e => setForm(v => ({ ...v, volume: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 !bg-white px-3 py-2 !text-slate-900 placeholder:!text-slate-400" placeholder="0" />
            </label>
            <label className="text-sm !text-slate-800">Transport
              <select value={form.transportMode} onChange={e => setForm(v => ({ ...v, transportMode: e.target.value as ImportShipment['transportMode'] }))} className="mt-1 w-full rounded-lg border border-slate-300 !bg-white px-3 py-2 !text-slate-900 placeholder:!text-slate-400">
                <option value="Aérien">Aérien</option><option value="Maritime">Maritime</option>
              </select>
            </label>
            <label className="text-sm !text-slate-800">Photos du colis
              <span className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 hover:bg-gray-50"><Camera size={18} /> Ajouter des photos
                <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => handlePhotos(e.target.files)} />
              </span>
            </label>
          </div>
          {photos.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{photos.map((src, i) => <div key={i} className="relative"><img src={src} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" /><button onClick={() => setPhotos(p => p.filter((_, index) => index !== i))} className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white"><Trash2 size={12} /></button></div>)}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={resetForm} className="rounded-lg border px-4 py-2">Annuler</button>
            <button disabled={saving} onClick={saveShipment} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-50"><Save size={16} /> {saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </section>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded-xl border border-slate-300 !bg-white py-3 pl-10 pr-4 !text-slate-900 placeholder:!text-slate-400" placeholder="Rechercher uniquement par numéro tracking…" />
      </div>

      <div className="flex items-center justify-between text-sm !text-slate-500">
        <span>{filteredShipments.length} colis</span>
        <button onClick={refresh} className="inline-flex items-center gap-1 hover:text-amber-600"><RefreshCw size={14} /> Actualiser</button>
      </div>

      {filteredShipments.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center !text-slate-500"><Package className="mx-auto mb-2" size={30} />{search ? 'Aucun colis ne correspond à ce numéro tracking.' : 'Aucun colis enregistré.'}</div>
      ) : (
        <div className="grid gap-3">
          {filteredShipments.map(shipment => (
            <article key={shipment.id} className="rounded-xl border border-slate-200 !bg-white p-4 !text-slate-900 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold !text-slate-500">NUMÉRO TRACKING</p>
                  <h3 className="break-all text-lg font-bold !text-slate-900">{shipment.trackingNumber || shipment.reference || 'Non renseigné'}</h3>
                  <p className="mt-1 font-medium !text-slate-800">{shipment.description}</p>
                </div>
                <select value={shipment.status} onChange={e => updateStatus(shipment, e.target.value as ImportShipmentStatus)} className="max-w-full rounded-lg border border-slate-300 !bg-white px-2 py-2 text-sm !text-slate-900">
                  {STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm !text-slate-600">
                <span>Poids : <b>{shipment.weight || 0} kg</b></span>
                <span>Volume : <b>{shipment.volume || 0} CBM</b></span>
                <span>Transport : <b>{shipment.transportMode}</b></span>
                <span>Enregistré : <b>{(shipment.createdAt || '').slice(0, 10) || '—'}</b></span>
              </div>
              {!!shipment.photos?.length && <div className="mt-3 flex flex-wrap gap-2">{shipment.photos.map((src, i) => <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Colis ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" /></a>)}</div>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImportExportModule;
