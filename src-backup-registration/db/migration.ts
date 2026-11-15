import { Preferences } from '@capacitor/preferences';
import { appRepository } from './storage';
import { callFunction } from '../firebase/functionsClient';
import { newRequestId } from '../firebase/tenancy';

/**
 * Migration des données locales vers Firestore (entreprise + établissement choisis).
 *
 * Garanties :
 *  - les données locales ne sont JAMAIS modifiées ni supprimées ;
 *  - reprise possible après coupure (même migrationId, lots idempotents) ;
 *  - clôture refusée au moindre écart de comptage.
 */
const CHUNK = 150;
const STATE_KEY = 'bta_migration_state_v1';

export interface MigrationProgress { collection: string; done: number; total: number }
export interface MigrationResult { migrationId: string; counts: Record<string, number>; skipped: Record<string, number> }

interface SavedState { tenantId: string; branchId: string; migrationId: string; complete?: boolean }

async function loadState(): Promise<SavedState | null> {
  const { value } = await Preferences.get({ key: STATE_KEY });
  return value ? (JSON.parse(value) as SavedState) : null;
}
const saveState = (s: SavedState) => Preferences.set({ key: STATE_KEY, value: JSON.stringify(s) });

export async function isMigrated(tenantId: string): Promise<boolean> {
  const s = await loadState();
  return !!s && s.complete === true && s.tenantId === tenantId;
}

/** Découpe l'état local en collections prêtes à envoyer. */
export function buildPayload() {
  const st = appRepository.getState();
  const products = st.products.map(({ currentStock: _c, minStock: _m, ...rest }) => rest);
  const stock = st.products.map((p) => ({
    id: p.id, productId: p.id, productName: p.name, currentStock: p.currentStock, minStock: p.minStock, unit: p.unit,
  }));
  const tenantLevel: Record<string, { id: string }[]> = {
    settings: [{ id: 'general', ...st.settings }],
    categories: st.categories, customers: st.customers, suppliers: st.suppliers, products,
  };
  const branchLevel: Record<string, { id: string }[]> = {
    stock,
    stockMovements: st.stockMovements, sales: st.sales, purchases: st.purchases, expenses: st.expenses,
    debts: st.debts, reservations: st.reservations, reservationPayments: st.reservationPayments,
    reservationCancellations: st.reservationCancellations, reservationDeliveries: st.reservationDeliveries,
    stockDamages: st.stockDamages, freeIssues: st.freeIssues,
  };
  return { ...tenantLevel, ...branchLevel };
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const code = (e as { code?: string }).code;
      // Erreurs définitives : inutile de réessayer.
      if (code && !['NETWORK', 'TIMEOUT', 'UNAVAILABLE', 'INTERNAL'].includes(code)) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw last;
}

export async function migrateLocalData(
  tenantId: string, branchId: string, onProgress?: (p: MigrationProgress) => void,
): Promise<MigrationResult> {
  let state = await loadState();
  if (!state || state.tenantId !== tenantId || state.branchId !== branchId || state.complete) {
    if (state?.complete && state.tenantId === tenantId) throw new Error('Les données de cet appareil sont déjà migrées.');
    state = { tenantId, branchId, migrationId: newRequestId() };
    await saveState(state);
  }
  const { migrationId } = state;
  const payload = buildPayload();
  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  for (const [collection, docs] of Object.entries(payload)) {
    counts[collection] = docs.length;
    skipped[collection] = 0;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = docs.slice(i, i + CHUNK);
      const r = await withRetry(() =>
        callFunction<{ written: number; skipped: number }>('migrationImport', {
          tenantId, branchId, migrationId, collection, docs: JSON.parse(JSON.stringify(batch)),
        }, 60000));
      skipped[collection] += r.skipped;
      onProgress?.({ collection, done: Math.min(i + CHUNK, docs.length), total: docs.length });
    }
  }

  await withRetry(() => callFunction('migrationFinalize', { tenantId, branchId, migrationId, expected: counts }, 60000));
  await saveState({ ...state, complete: true });
  return { migrationId, counts, skipped };
}
