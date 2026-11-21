/**
 * Storage and Repository Engine for BTA Business Transform Africa
 * Mirrors Android Room Database + WorkManager + Firestore Sync Architecture
 */

import {
  Product,
  Category,
  Customer,
  Supplier,
  Sale,
  Purchase,
  StockMovement,
  Expense,
  DebtRecord,
  CompanySettings,
  User,
  SyncStatusInfo,
  PaymentMethod,
  Reservation,
  ReservationItem,
  ReservationStockPolicy,
  ReservationPayment,
ReservationCancellation,
  ReservationDelivery,
  StockDamage,
  StockDamageStatus,
  FreeIssue,
  UserRole,
  CargoPackage,
  CargoEvent,
  CargoPayment,
  ImportSupplier, ImportShipment, ImportExpense, ImportTrackingEvent, ImportPayment, ImportExportDocument,
} from '../types';
import {
  INITIAL_SETTINGS,
  INITIAL_USERS,
  INITIAL_CATEGORIES,
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_SUPPLIERS,
  INITIAL_SALES,
  INITIAL_PURCHASES,
  INITIAL_STOCK_MOVEMENTS,
  INITIAL_EXPENSES,
  INITIAL_DEBTS,
} from './initialData';
import { generateReferenceNumber, generateUUID, usdToCdf } from '../utils/currency';
import { generateSalt, hashPinSync, verifyPinSync, isSeedDefaultPin, isWeakPin } from '../utils/security';
import { API_BASE, API_KEY, SYNC_ENABLED } from '../utils/config';
import { Baseline, Effects, PULL_ORDER, applyPulled, diffState, makeBaseline, splitEffects, trackedIds } from './syncEngine';
import { isTransient, pullAll, pushOps, PullCursor, PulledDoc } from './cloudSync';
import localforage from 'localforage';
import { Preferences } from '@capacitor/preferences';
import { coreOperationStatus, corePushOperation, coreCargoUpsert, coreCargoPull, coreImportExportUpsert, coreImportExportPull, CoreApiError } from '../core/api';
import { getLocalId, getServerId, mapServerId } from '../core/persistence';
import type { CoreBootstrapSnapshot } from '../core/bootstrap';
import { fetchCoreBootstrap } from '../core/bootstrap';

// Configure localforage for Android IndexedDB / SQLite leveldb persistence
if (typeof window !== 'undefined') {
  localforage.config({
    name: 'bta_business_transform_africa',
    storeName: 'commercial_records_v1',
    description: 'Stockage local persistant hors connexion pour BTA Manager (compatibilité Android SQLite/IndexedDB)',
  });
}

interface AppDatabaseState {
  settings: CompanySettings;
  users: User[];
  currentUser: User;
  categories: Category[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  purchases: Purchase[];
  stockMovements: StockMovement[];
  expenses: Expense[];
  debts: DebtRecord[];
  reservations: Reservation[];
  reservationCancellations: ReservationCancellation[];
  reservationPayments: ReservationPayment[];
  reservationDeliveries: ReservationDelivery[];
  stockDamages: StockDamage[];
  freeIssues: FreeIssue[];
  cargoPackages: CargoPackage[];
  importSuppliers: ImportSupplier[];
  importShipments: ImportShipment[];
  importExpenses: ImportExpense[];
  importTrackingEvents: ImportTrackingEvent[];
  importPayments: ImportPayment[];
  importDocuments: ImportExportDocument[];
  offlineQueue: Array<{ id: string; type: string; payload: unknown; timestamp: string; status?: 'PENDING'|'PROCESSING'|'FAILED'|'REVIEW'; attempts?: number; error?: string; corePayload?: Record<string, unknown> }>;
  coreSyncHistory: Array<{ id:string; type:string; status:'DONE'|'FAILED'|'REVIEW'; timestamp:string; error?:string }>;
  coreScope?: { tenantId: number; branchId: number };
  coreActorId?: number;
  syncInfo: SyncStatusInfo;
  /** Synchronisation entreprise (Firestore) : présent seulement une fois la migration/jonction faite. */
  cloud?: {
    tenantId: string;
    branchId: string;
    lastPull: number;
    baseline: Baseline;
    rejections: Array<{ at: string; reason: string }>;
    pullCursor?: PullCursor;
    /** Collections dont la lecture a été refusée ; elles sont retentées depuis leur ancien curseur. */
    deferredPullCollections?: string[];
    deferredPullSince?: number;
    /** Version du mécanisme de rattrapage ; absent sur les installations précédentes. */
    pullRecoveryVersion?: number;
    failedOps?: Array<{ id: string; timestamp: string; payload: unknown; reason: string; at: string }>;
  };
  savedAt?: number;
}

const STORAGE_KEY = 'bta_business_transform_africa_db_v1';
const LOCKOUT_KEY = 'bta_login_lockout_v1';
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_BASE_MS = 30_000;

function backupChecksum(value: string): string {
  let crc = 0xffffffff;
  for (let i = 0; i < value.length; i++) {
    crc ^= value.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function validateBackupData(data: Partial<AppDatabaseState>): data is Partial<AppDatabaseState> & { settings: CompanySettings } {
  if (!data || typeof data !== 'object' || !data.settings || typeof data.settings !== 'object' ||
    !isNum(data.settings.exchangeRate) || data.settings.exchangeRate < 100 || data.settings.exchangeRate > 100000) return false;
  const required = ['categories', 'products', 'customers', 'suppliers', 'sales', 'purchases', 'stockMovements', 'expenses', 'debts'] as const;
  const optional = ['reservations', 'reservationCancellations', 'reservationPayments', 'reservationDeliveries', 'stockDamages', 'freeIssues', 'cargoPackages', 'importSuppliers', 'importShipments', 'importExpenses', 'importTrackingEvents', 'importPayments', 'importDocuments'] as const;
  for (const key of required) if (!Array.isArray(data[key])) return false;
  for (const key of optional) if (data[key] !== undefined && !Array.isArray(data[key])) return false;
  const arrays = [...required, ...optional] as const;
  for (const collection of arrays) {
    const docs = (data[collection] ?? []) as unknown as Array<Record<string, unknown>>;
    const ids = new Set<string>();
    for (const doc of docs) {
      if (!doc || typeof doc !== 'object' || typeof doc.id !== 'string' || !doc.id.trim() || ids.has(doc.id)) return false;
      ids.add(doc.id);
      if (collection === 'sales' && (!Array.isArray(doc.items) || !isNum(doc.totalUSD))) return false;
      if (collection === 'purchases' && (!Array.isArray(doc.items) || !isNum(doc.totalUSD))) return false;
      if (collection === 'products' && (!isNum(doc.currentStock) || !isNum(doc.sellPriceUSD))) return false;
      if (collection === 'debts' && (!isNum(doc.initialAmountUSD) || !isNum(doc.remainingBalanceUSD) || !Array.isArray(doc.history))) return false;
      const stack: Array<{ value: unknown; key: string }> = [{ value: doc, key: '' }];
      while (stack.length) {
        const { value, key } = stack.pop()!;
        if (typeof value === 'number' && (!Number.isFinite(value) || (/USD|CDF|amount|balance|quantity|price|rate|stock/i.test(key) && Math.abs(value) > 1e12))) return false;
        if (Array.isArray(value)) value.forEach((v) => stack.push({ value: v, key }));
        else if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (/(date|at)$/i.test(k) && typeof v === 'string' && v && !Number.isFinite(Date.parse(v))) return false;
            stack.push({ value: v, key: k });
          }
        }
      }
    }
  }
  return true;
}

const ADMIN_ROLES: UserRole[] = ["ADMIN"];
const MANAGER_ROLES: UserRole[] = ["ADMIN", "GESTIONNAIRE"];

/** Rounds to cents to avoid floating point drift in money amounts. */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

class AppRepository {
  private state: AppDatabaseState;
  private listeners: Set<() => void> = new Set();
  /** Id of the logged-in user. Kept in memory only: the app is locked at every launch. */
  private sessionUserId: string | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private isBootstrapping = false;
  private durableWrites: Promise<void> = Promise.resolve();
  private corePermissions = new Set<string>();
  private coreContext: { tenantId: number; branchId: number } | null = null;
  private initialization: Promise<void> = Promise.resolve();
  /** Incrémenté à chaque changement local capturé : permet d'abandonner une lecture serveur périmée. */
  private rev = 0;

  constructor() {
    this.state = this.loadFromStorage();
    this.initialization = this.initAsyncStorage();
    // Simulate auto network listening
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
      // Make sure the durable layers are written when the app goes to background / closes
      const flushNow = () => {
        if (this.persistTimer) {
          clearTimeout(this.persistTimer);
          this.flushDurable();
        }
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow();
      });
      window.addEventListener('pagehide', flushNow);
    }
  }

  private async initAsyncStorage() {
    if (typeof window === 'undefined') return;

    const MIGRATION_KEY = 'bta_initial_inventory_migration_v1';
    const MIGRATION_VERSION = '1';

    try {
      const prefMarker = await Preferences.get({ key: MIGRATION_KEY });
      const localMarker = localStorage.getItem(MIGRATION_KEY);

      if (
        localMarker !== MIGRATION_VERSION &&
        prefMarker.value !== MIGRATION_VERSION
      ) {
        // Lire les sauvegardes existantes uniquement pour préserver les comptes
        // et les paramètres, jamais pour restaurer les anciennes données commerciales.
        const indexedData = await localforage.getItem<AppDatabaseState>(STORAGE_KEY);
        const prefData = await Preferences.get({ key: STORAGE_KEY });

        let saved: AppDatabaseState | null = null;

        try {
          if (prefData.value) {
            saved = JSON.parse(prefData.value) as AppDatabaseState;
          }
        } catch {
          saved = null;
        }

        if (
          indexedData &&
          (!saved || (indexedData.savedAt || 0) > (saved.savedAt || 0))
        ) {
          saved = indexedData;
        }

        let usersToKeep = saved?.users?.length
          ? saved.users
          : this.state.users?.length
            ? this.state.users
            : INITIAL_USERS;

        usersToKeep = this.ensureUserPins(usersToKeep);

        const oldCurrentId =
          this.state.currentUser?.id || saved?.currentUser?.id;

        const currentUser =
          usersToKeep.find((u) => u.id === oldCurrentId) || usersToKeep[0];

       const baseState =
  saved && (saved.savedAt || 0) > (this.state.savedAt || 0)
    ? saved
    : this.state;

const cleanState: AppDatabaseState = {
  ...this.getDefaultState(),
  ...baseState,
  settings: baseState.settings || this.state.settings || INITIAL_SETTINGS,
  users: usersToKeep,
  currentUser:
    usersToKeep.find((u) => u.id === oldCurrentId) || usersToKeep[0],
  offlineQueue: baseState.offlineQueue || [],
  coreSyncHistory: baseState.coreSyncHistory || [],
  syncInfo: {
    ...baseState.syncInfo,
    pendingCount: (baseState.offlineQueue || []).length,
  },
  savedAt: Date.now(),
};

        this.state = cleanState;

        // Écrire d'abord les trois stockages propres.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanState));
        await localforage.setItem(STORAGE_KEY, cleanState);
        await Preferences.set({
          key: STORAGE_KEY,
          value: JSON.stringify(cleanState),
        });

        // Marquer la migration seulement après la sauvegarde des données propres.
        localStorage.setItem(MIGRATION_KEY, MIGRATION_VERSION);
        await Preferences.set({
          key: MIGRATION_KEY,
          value: MIGRATION_VERSION,
        });

        this.notify();
        console.info('BTA inventory migration completed successfully.');
        return;
      }

      // Migration déjà effectuée : comportement normal de restauration.
      const localSavedAt = this.state.savedAt || 0;
      let best: AppDatabaseState | null = null;
      let bestAt = localSavedAt;

      const indexedData = await localforage.getItem<AppDatabaseState>(STORAGE_KEY);
      if (indexedData && indexedData.products && (indexedData.savedAt || 0) > bestAt) {
        best = indexedData;
        bestAt = indexedData.savedAt || 0;
      }

      const prefData = await Preferences.get({ key: STORAGE_KEY });
      if (prefData.value) {
        const parsed = JSON.parse(prefData.value) as AppDatabaseState;
        if (parsed && parsed.products && (parsed.savedAt || 0) > bestAt) {
          best = parsed;
          bestAt = parsed.savedAt || 0;
        }
      }

      if (best) {
        const merged = { ...this.getDefaultState(), ...best };
        merged.users = this.ensureUserPins(merged.users || INITIAL_USERS);
        merged.currentUser =
          merged.users.find((u) =>
            u.id === (this.sessionUserId || best!.currentUser?.id)
          ) || merged.users[0];

        this.state = merged;
        this.notify();
      }
    } catch (e) {
      console.error('BTA storage initialization/migration error:', e);
    }
  }

  private ensureUserPins(users: User[]): User[] {
    // Missing credentials stay unset so first-run setup can create a reachable administrator;
    // silently inventing an unknown PIN would lock every local account out.
    return users;
  }

  private loadFromStorage(): AppDatabaseState {
    if (typeof window === 'undefined') {
      return this.getDefaultState();
    }
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data) as AppDatabaseState;
        const users = this.ensureUserPins(parsed.users || INITIAL_USERS);

        const currentUser =
          users.find((u) => u.id === (parsed.currentUser?.id || INITIAL_USERS[0].id)) || users[0];

        return {
          ...this.getDefaultState(),
          ...parsed,
          users,
          currentUser,
          syncInfo: {
            status: navigator.onLine ? 'ONLINE' : 'OFFLINE',
            lastSyncTime: new Date().toISOString(),
            pendingCount: parsed.offlineQueue?.length || 0,
          },
        };
      }
    } catch (e) {
      console.warn('Failed to parse stored BTA state, initializing default dataset:', e);
    }
    return this.getDefaultState();
  }

  private getDefaultState(): AppDatabaseState {
    return {
      settings: INITIAL_SETTINGS,
      users: INITIAL_USERS,
      currentUser: INITIAL_USERS[0],
      categories: INITIAL_CATEGORIES,
      products: INITIAL_PRODUCTS,
      customers: INITIAL_CUSTOMERS,
      suppliers: INITIAL_SUPPLIERS,
      sales: INITIAL_SALES,
      purchases: INITIAL_PURCHASES,
      stockMovements: INITIAL_STOCK_MOVEMENTS,
      expenses: INITIAL_EXPENSES,
      debts: INITIAL_DEBTS,
      cargoPackages: [],
      importSuppliers: [], importShipments: [], importExpenses: [], importTrackingEvents: [], importPayments: [], importDocuments: [],
reservations: [],
reservationCancellations: [],
reservationPayments: [],
reservationDeliveries: [],
stockDamages: [],
freeIssues: [],
      offlineQueue: [],
      coreSyncHistory: [],
      syncInfo: {
        status: typeof navigator !== 'undefined' && navigator.onLine ? 'ONLINE' : 'OFFLINE',
        lastSyncTime: new Date().toISOString(),
        pendingCount: 0,
      },
    };
  }

  /** Transforme les changements locaux depuis la dernière base de référence en opérations en file. */
  private captureChanges() {
    if (this.coreContext || this.state.coreScope) return;
    const cloud = this.state.cloud;
    if (!cloud) return;
    const { effects, baseline } = diffState(this.state as unknown as Record<string, unknown>, cloud.baseline);
    if (!effects) return;
    cloud.baseline = baseline;
    const now = new Date().toISOString();
    for (const part of splitEffects(effects)) {
      this.state.offlineQueue.push({ id: generateUUID(), type: 'EFFECTS', payload: part, timestamp: now });
    }
    this.state.syncInfo.pendingCount = this.state.offlineQueue.length;
    this.rev++;
  }

  private persist() {
    this.rev++;
    this.captureChanges();
    this.state.savedAt = Date.now();
    if (typeof window !== 'undefined') {
      // Layer 1: synchronous localStorage (immediate, small safety net)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (err) {
        console.warn('LocalStorage limit or error:', err);
      }
      // Layers 2 & 3 are heavier: coalesce bursts of writes
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => this.flushDurable(), 400);
    }
    this.notify();
  }

  private flushDurable() {
    void this.flushDurableAndWait().catch(error => console.warn('BTA durable storage write failed:', error));
  }

  private async flushDurableAndWait() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    const snapshot = JSON.parse(JSON.stringify(this.state)) as AppDatabaseState;
    // Serialize writes so an older background flush cannot overwrite a newer queue checkpoint.
    this.durableWrites = this.durableWrites.catch(() => {}).then(async () => {
      await Promise.all([
        localforage.setItem(STORAGE_KEY, snapshot),
        Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(snapshot) }),
      ]);
    });
    await this.durableWrites;
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  // Network & Sync State
  private handleNetworkChange(online: boolean) {
    this.state.syncInfo.status = online ? 'ONLINE' : 'OFFLINE';
    if (online && this.state.offlineQueue.length > 0) {
      this.triggerSync();
    } else {
      this.notify();
    }
  }

  public toggleNetworkMode(): boolean {
    const isCurrentlyOnline = this.state.syncInfo.status !== 'OFFLINE';
    const nextStatus = isCurrentlyOnline ? 'OFFLINE' : 'ONLINE';
    this.state.syncInfo.status = nextStatus;
    if (nextStatus === 'ONLINE' && this.state.offlineQueue.length > 0) {
      this.triggerSync();
    } else {
      this.notify();
    }
    return nextStatus === 'ONLINE';
  }

  /** Ids of entities contained in the queue items that the server confirmed. */
  private markSynced(confirmedQueueIds: Set<string>) {
    const confirmed = this.state.offlineQueue.filter((q) => confirmedQueueIds.has(q.id));
    const ids = new Set<string>(
      confirmed.map((q) => (q.payload as { id?: string } | null)?.id).filter((x): x is string => !!x)
    );
    this.state.sales = this.state.sales.map((x) => (ids.has(x.id) ? { ...x, syncStatus: 'SYNCED' } : x));
    this.state.purchases = this.state.purchases.map((x) => (ids.has(x.id) ? { ...x, syncStatus: 'SYNCED' } : x));
    this.state.expenses = this.state.expenses.map((x) => (ids.has(x.id) ? { ...x, syncStatus: 'SYNCED' } : x));
    this.state.offlineQueue = this.state.offlineQueue.filter((q) => !confirmedQueueIds.has(q.id));
  }

  // ---------- Synchronisation entreprise (Firestore) ----------

  public isCloudEnabled(): boolean {
    return !!this.state.cloud;
  }

  public getCloudContext() {
    const c = this.state.cloud;
    return c ? { tenantId: c.tenantId, branchId: c.branchId } : null;
  }

  /** Switches the single active local workspace only after every local operation is resolved. */
  public switchCloudContext(tenantId: string, branchId: string) {
    this.requireLoggedIn();
    const current = this.state.cloud;
    if (!current) throw new Error('Cet appareil n’est pas synchronisé avec une entreprise.');
    if (current.tenantId === tenantId && current.branchId === branchId) return;
    if (this.isSyncing || this.state.offlineQueue.length || current.rejections.length) {
      throw new Error('Résolvez ou synchronisez les opérations locales avant de changer d’établissement.');
    }
    if (diffState(this.state as unknown as Record<string, unknown>, current.baseline).effects) {
      throw new Error('Des changements locaux ne sont pas encore confirmés par le serveur.');
    }
    if (this.state.syncInfo.status === 'OFFLINE' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      throw new Error('Une connexion est requise pour charger le nouvel établissement sans perdre les données locales.');
    }
    this.state = {
      ...this.state,
      settings: INITIAL_SETTINGS,
      categories: [], products: [], customers: [], suppliers: [], sales: [], purchases: [],
      stockMovements: [], expenses: [], debts: [], reservations: [], reservationCancellations: [],
      reservationPayments: [], reservationDeliveries: [], stockDamages: [], freeIssues: [], cargoPackages: [],
      importSuppliers: [], importShipments: [], importExpenses: [], importTrackingEvents: [], importPayments: [], importDocuments: [],
      offlineQueue: [],
      cloud: { tenantId, branchId, lastPull: 0, baseline: makeBaseline({
        settings: INITIAL_SETTINGS, categories: [], products: [], customers: [], suppliers: [], sales: [], purchases: [],
        stockMovements: [], expenses: [], debts: [], reservations: [], reservationCancellations: [],
        reservationPayments: [], reservationDeliveries: [], stockDamages: [], freeIssues: [], cargoPackages: [],
      }), rejections: [], failedOps: [] },
      syncInfo: { ...this.state.syncInfo, pendingCount: 0, errorMessage: undefined },
    };
    this.persist();
    void this.triggerSync();
  }

  public getSyncRejections() {
    return (this.state.cloud?.failedOps ?? []).map(({ id, reason, at }) => ({ id, reason, at }));
  }

  public retryRejectedOperation(id: string) {
    this.requireLoggedIn();
    const cloud = this.state.cloud;
    const failed = cloud?.failedOps?.find((x) => x.id === id);
    if (!cloud || !failed) throw new Error('Opération refusée introuvable.');
    cloud.failedOps = cloud.failedOps!.filter((x) => x.id !== id);
    cloud.rejections = cloud.rejections.filter((x) => x.at !== failed.at || x.reason !== failed.reason);
    this.state.offlineQueue.push({ id: generateUUID(), timestamp: new Date().toISOString(), type: 'EFFECTS', payload: failed.payload });
    this.state.syncInfo.pendingCount = this.state.offlineQueue.length;
    this.persist();
    if (this.state.syncInfo.status !== 'OFFLINE') void this.triggerSync();
  }

  /** À appeler une fois la migration terminée : l'état actuel devient la référence. */
  public enableCloudSync(tenantId: string, branchId: string) {
    this.requireAdmin();
    this.state.offlineQueue = [];
    this.state.cloud = { tenantId, branchId, lastPull: 0, baseline: makeBaseline(this.state as unknown as Record<string, unknown>), rejections: [], failedOps: [] };
    this.state.syncInfo.pendingCount = 0;
    this.persist();
    void this.triggerSync();
  }

  /**
   * Nouvel appareil d'une entreprise existante : efface les données commerciales locales (démo),
   * puis télécharge celles de l'entreprise. Les comptes/PIN locaux sont conservés.
   */
  public joinCloudAsNewDevice(tenantId: string, branchId: string) {
    this.requireAdmin();
    if (this.state.cloud) throw new Error('Cet appareil est déjà connecté à une entreprise.');
    this.state = {
      ...this.state,
      categories: [], products: [], customers: [], suppliers: [], sales: [], purchases: [],
      stockMovements: [], expenses: [], debts: [], reservations: [], reservationCancellations: [],
      reservationPayments: [], reservationDeliveries: [], stockDamages: [], freeIssues: [], cargoPackages: [],
      importSuppliers: [], importShipments: [], importExpenses: [], importTrackingEvents: [], importPayments: [], importDocuments: [],
      offlineQueue: [],
    };
    this.state.cloud = { tenantId, branchId, lastPull: 0, baseline: makeBaseline(this.state as unknown as Record<string, unknown>), rejections: [], failedOps: [] };
    this.persist();
    void this.triggerSync();
  }

  private markEffectsSynced(effects: Effects, status: 'SYNCED' | 'ERROR') {
    const ids = trackedIds(effects);
    for (const key of ['sales', 'purchases', 'expenses'] as const) {
      const set = new Set(ids[key]);
      if (set.size === 0) continue;
      (this.state[key] as Array<{ id: string; syncStatus: 'SYNCED' | 'PENDING' | 'ERROR' }>).forEach((r) => {
        if (set.has(r.id)) r.syncStatus = status;
      });
    }
  }

  private async cloudSync(): Promise<boolean> {
    if (this.state.syncInfo.status === 'OFFLINE') return false;
    if (this.isSyncing) return false;
    this.isSyncing = true;
    this.state.syncInfo.status = 'SYNCING';
    this.notify();
    try {
      // Core bearer sessions are owned by CoreSessionGate. Local operations remain
      // queued until the Core adapter can map every local reference to a server ID.
      const { getCoreToken } = await import('../core/api');
      if (!(await getCoreToken())) throw new Error('Session Core absente ou expirée. Les opérations restent en attente.');
      const ctx = { tenantId: this.state.cloud!.tenantId, branchId: this.state.cloud!.branchId };

      // 1) Envoi : tant qu'il reste des opérations, par lots de 10, dans l'ordre.
      while (this.state.offlineQueue.length > 0) {
        const batch = this.state.offlineQueue.slice(0, 10);
        const results = await pushOps(ctx, batch.map((q) => ({
          opId: q.id, createdAt: Date.parse(q.timestamp) || Date.now(), effects: q.payload as Effects,
        })));
        const answered = new Set<string>();
        for (const r of results) {
          const item = batch.find((q) => q.id === r.opId);
          if (!item) continue;
          answered.add(r.opId);
          const eff = item.payload as Effects;
          if (r.status === 'REJECTED') {
            const rejectedAt = new Date().toISOString();
            this.markEffectsSynced(eff, 'ERROR');
            this.state.cloud!.failedOps ??= [];
            this.state.cloud!.failedOps.push({
              id: item.id, timestamp: item.timestamp, payload: item.payload,
              reason: r.reason || 'Opération refusée par le serveur.', at: rejectedAt,
            });
            this.state.cloud!.rejections = [
              { at: rejectedAt, reason: r.reason || 'Opération refusée par le serveur.' },
              ...this.state.cloud!.rejections,
            ].slice(0, 50);
          } else {
            this.markEffectsSynced(eff, 'SYNCED');
          }
        }
        if (answered.size === 0) throw new Error('Réponse du serveur incomplète.');
        this.state.offlineQueue = this.state.offlineQueue.filter((q) => !answered.has(q.id));
        this.state.syncInfo.pendingCount = this.state.offlineQueue.length;
        this.persist();
      }

      // 2) Lecture : seulement si rien n'est en attente (le local gagne tant qu'il n'est pas envoyé).
      const cloud = this.state.cloud!;
      const rev = this.rev;
      const applyPullPage = async (collection: string, docs: PulledDoc[], cursor: PullCursor) => {
        if (rev !== this.rev || this.state.offlineQueue.length > 0) {
          throw new Error('Une saisie locale est arrivée pendant la lecture ; reprise après son envoi.');
        }
        if (docs.length) applyPulled(this.state as unknown as Record<string, unknown>, cloud.baseline, collection, docs);
        cloud.pullCursor = cursor;
        this.state.syncInfo.syncProgress = { collection, recovered: cursor.recovered, phase: 'PULL' };
        this.persist();
        // Acknowledged progress survives an abrupt native process exit.
        await this.flushDurableAndWait();
      };

      // Resume an interrupted pull first. Otherwise, retry collections skipped in a previous
      // cycle before advancing the ordinary global watermark.
      if (cloud.pullRecoveryVersion !== 1 && cloud.pullCursor && !cloud.pullCursor.collections &&
          (cloud.pullCursor.since !== 0 ||
            (cloud.pullCursor.collectionIndex > 0 && cloud.pullCursor.deferredCollections === undefined))) {
        // Legacy cursors did not remember skipped collections. Restart once from zero to
        // recover documents that may have been skipped by the previous implementation.
        cloud.pullCursor = undefined;
      }
      if (!cloud.pullCursor) {
        if (cloud.deferredPullCollections?.length) {
          const collections = [...new Set(cloud.deferredPullCollections)];
          cloud.pullCursor = {
            since: Math.max(0, cloud.deferredPullSince ?? (cloud.lastPull - 60_000)),
            collectionIndex: 0, serverTime: 0, recovered: 0,
            collections, deferredCollections: collections,
          };
        } else {
          cloud.pullCursor = {
            since: cloud.pullRecoveryVersion === 1 ? Math.max(0, cloud.lastPull - 60_000) : 0,
            collectionIndex: 0, serverTime: 0, recovered: 0,
          };
        }
      }
      this.persist();
      await this.flushDurableAndWait();

      const isDeferredPull = !!cloud.pullCursor.collections;
      const activePullSince = cloud.pullCursor.since;
      let completed = await pullAll(ctx, cloud.pullCursor, applyPullPage);
      if (isDeferredPull) {
        // This was a deferred-only retry. Keep unresolved collections and their original
        // watermark; a successful retry clears them without changing lastPull.
        cloud.deferredPullCollections = completed.deferredCollections ?? [];
        if (cloud.deferredPullCollections.length === 0) {
          cloud.deferredPullCollections = undefined;
          cloud.deferredPullSince = undefined;
        } else {
          cloud.deferredPullSince = activePullSince;
        }
        cloud.pullCursor = undefined;
        this.persist();
        await this.flushDurableAndWait();

        cloud.pullCursor = {
          since: cloud.pullRecoveryVersion === 1 ? Math.max(0, cloud.lastPull - 60_000) : 0,
          collectionIndex: 0, serverTime: 0, recovered: 0,
        };
        this.persist();
        await this.flushDurableAndWait();
        completed = await pullAll(ctx, cloud.pullCursor, applyPullPage);
      }

      const newlyDeferred = completed.deferredCollections ?? [];
      if (newlyDeferred.length) {
        cloud.deferredPullCollections = [...new Set([...(cloud.deferredPullCollections ?? []), ...newlyDeferred])];
        cloud.deferredPullSince = Math.min(cloud.deferredPullSince ?? completed.since, completed.since);
      }
      cloud.lastPull = completed.serverTime || Date.now();
      cloud.pullRecoveryVersion = 1;
      cloud.pullCursor = undefined;
      this.state.syncInfo.syncProgress = undefined;
      this.persist();

      const rejected = this.state.cloud!.rejections.length > 0;
      this.state.syncInfo = {
        status: 'SYNCED',
        lastSyncTime: new Date().toISOString(),
        pendingCount: this.state.offlineQueue.length,
        ...(rejected ? { errorMessage: 'Certaines opérations ont été refusées par le serveur.' } : {}),
      };
      this.persist();
      this.scheduleBackToOnline(2500);
      if (this.state.offlineQueue.length > 0) void this.cloudSync();
      return true;
    } catch (err: unknown) {
      this.state.syncInfo = {
        status: 'ERROR',
        lastSyncTime: this.state.syncInfo.lastSyncTime,
        pendingCount: this.state.offlineQueue.length,
        errorMessage: isTransient(err) ? 'Connexion instable : réessai automatique.' : (err instanceof Error ? err.message : 'Échec de synchronisation'),
        ...(this.state.cloud?.pullCursor ? { syncProgress: {
          collection: (this.state.cloud.pullCursor.collections ?? PULL_ORDER)[Math.min(this.state.cloud.pullCursor.collectionIndex,
            (this.state.cloud.pullCursor.collections ?? PULL_ORDER).length - 1)] ?? 'lecture',
          recovered: this.state.cloud.pullCursor.recovered, phase: 'PULL' as const,
      } } : {}),
      };
      this.persist();
      if (this.state.cloud && isTransient(err) && this.state.syncInfo.status === 'ERROR' &&
        (this.state.offlineQueue.length > 0 || this.state.cloud.pullCursor) &&
        (typeof navigator === 'undefined' || navigator.onLine)) {
        setTimeout(() => { void this.triggerSync(); }, 15000);
      }
      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  public async triggerSync(): Promise<boolean> {
    if (this.coreContext) return this.coreSync();
    if (this.state.coreScope) return false; // Wait for the authenticated Core session; never send a Core queue to Firebase.
    if (this.state.cloud) return this.cloudSync();
    // Standalone mode (no server configured): everything is stored on the device, nothing to push.
    if (!SYNC_ENABLED) {
      this.state.syncInfo = {
        status: this.state.syncInfo.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE',
        lastSyncTime: this.state.syncInfo.lastSyncTime,
        pendingCount: 0,
      };
      this.notify();
      return true;
    }

    if (this.state.syncInfo.status === 'OFFLINE') return false;
    if (this.isSyncing) return false;
    this.isSyncing = true;

    this.state.syncInfo.status = 'SYNCING';
    this.notify();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      // Nothing pending: just check that the server answers (and answers JSON, not an HTML page)
      if (this.state.offlineQueue.length === 0) {
        const ping = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
        const body = ping.ok ? await ping.json() : null;
        if (!body || body.status !== 'ok') throw new Error('Serveur injoignable');
        this.state.syncInfo = { status: 'SYNCED', lastSyncTime: new Date().toISOString(), pendingCount: 0 };
        this.notify();
        this.scheduleBackToOnline(2000);
        return true;
      }

      const response = await fetch(`${API_BASE}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify({
          queue: this.state.offlineQueue,
          clientTime: new Date().toISOString(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Erreur serveur HTTP ${response.status}`);

      const result = await response.json();
      if (!result || !result.success) throw new Error((result && result.error) || 'Échec de validation serveur');

      this.markSynced(new Set<string>(result.syncedIds || []));
      this.state.syncInfo = {
        status: 'SYNCED',
        lastSyncTime: result.serverTime || new Date().toISOString(),
        pendingCount: this.state.offlineQueue.length,
      };
      this.persist();
      this.scheduleBackToOnline(2500);
      return true;
    } catch (err: unknown) {
      const msg =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Délai dépassé'
          : err instanceof Error
          ? err.message
          : 'Échec de synchronisation';
      console.warn('Sync failed:', msg);
      this.state.syncInfo = {
        status: 'ERROR',
        lastSyncTime: this.state.syncInfo.lastSyncTime,
        pendingCount: this.state.offlineQueue.length,
        errorMessage: msg,
      };
      this.notify();
      return false;
    } finally {
      clearTimeout(timeout);
      this.isSyncing = false;
    }
  }

  private async coreSync(): Promise<boolean> {
    if (!this.coreContext || this.isSyncing || this.isBootstrapping || this.state.syncInfo.status === 'OFFLINE' || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;
    this.isSyncing = true;
    this.state.syncInfo.status = 'SYNCING';
    this.notify();
    try {
      const { getCoreToken } = await import('../core/api');
      if (!(await getCoreToken())) throw new CoreApiError(401, 'bta_unauthenticated', 'Session Core absente ou expirée.');
      const ctx = this.coreContext;
      if (!this.state.coreScope || this.state.coreScope.tenantId !== ctx.tenantId || this.state.coreScope.branchId !== ctx.branchId) throw new Error('Contexte de synchronisation incohérent.');
      for (let index = 0; index < this.state.offlineQueue.length;) {
        const queued = this.state.offlineQueue[index] as AppDatabaseState['offlineQueue'][number];
        if (queued.status === 'FAILED' || queued.status === 'REVIEW') { index++; continue; }
        if (queued.status === 'PROCESSING' && queued.type !== 'IMPORT_EXPORT_RECORD_UPSERT') {
          try {
            const status = await coreOperationStatus(ctx.tenantId, queued.id);
            if (status.status === 'PROCESSING') break;
            if (status.status === 'REVIEW' || status.status === 'FAILED') {
              queued.status = status.status;
              queued.error = status.error?.message;
              index++;
              continue;
            }
            if (status.status === 'DONE') {
              await this.applyCoreAck(queued, status.result ?? { success: true, operation_id: queued.id, duplicate: true });
              this.state.offlineQueue.splice(index, 1);
              continue;
            }
          } catch (error) {
            if (!(error instanceof CoreApiError && error.status === 404 && error.code === 'bta_sync_operation_not_found')) throw error;
          }
        }
        queued.status = 'PROCESSING';
        queued.attempts = (queued.attempts ?? 0) + 1;
        this.persist();
        try {
          if (queued.type === 'IMPORT_EXPORT_RECORD_UPSERT') {
            const record = queued.payload as { id:string; type:'supplier'|'shipment'|'expense'|'tracking'|'payment'|'document'; data:Record<string,unknown> };
            const result = await coreImportExportUpsert(ctx.tenantId, ctx.branchId, record);
            if (result.success !== true || result.record_id !== record.id || result.record_type !== record.type) {
              queued.status = 'REVIEW'; queued.error = 'Accusé Import-Export invalide; opération conservée.'; index++; continue;
            }
            this.state.coreSyncHistory.unshift({ id: queued.id, type: queued.type, status: 'DONE', timestamp: new Date().toISOString() });
            this.state.coreSyncHistory = this.state.coreSyncHistory.slice(0, 500);
            this.state.offlineQueue.splice(index, 1);
            this.persist();
            continue;
          }
          if (queued.type === 'CARGO_PACKAGE_UPSERT') {
            const packageRecord = queued.payload as CargoPackage;
            const result = await coreCargoUpsert(ctx.tenantId, ctx.branchId, packageRecord as unknown as Record<string, unknown>);
            if (result.success !== true || result.package_id !== packageRecord.id) {
              queued.status = 'REVIEW'; queued.error = 'Accusé Cargo invalide; opération conservée.'; index++; continue;
            }
            const local = this.state.cargoPackages.find(item => item.id === packageRecord.id);
            if (local) local.syncStatus = 'SYNCED';
            this.state.coreSyncHistory.unshift({ id: queued.id, type: queued.type, status: 'DONE', timestamp: new Date().toISOString() });
            this.state.coreSyncHistory = this.state.coreSyncHistory.slice(0, 500);
            this.state.offlineQueue.splice(index, 1);
            this.persist();
            continue;
          }
          const payload = queued.corePayload ?? await this.toCorePayload(queued.type, queued.payload as Record<string, unknown>);
          queued.corePayload = JSON.parse(JSON.stringify(payload));
          this.persist();
          await this.flushDurableAndWait();
          const result = await corePushOperation(ctx.tenantId, queued.id, this.toCoreOperationType(queued.type), payload);
          if (result.success !== true || result.operation_id !== queued.id) {
            queued.status = 'REVIEW'; queued.error = 'Accusé Core invalide; aucune synchronisation déclarée.'; index++; continue;
          }
          await this.applyCoreAck(queued, result);
          this.state.offlineQueue.splice(index, 1);
        } catch (error) {
          if (error instanceof CoreApiError && error.code === 'bta_id_mapping_missing') {
            queued.status = 'PENDING'; queued.error = error.message; break;
          }
          if (error instanceof CoreApiError && error.status > 0 && error.status < 500) {
            const retryable = error.code === 'bta_sync_in_progress';
            queued.status = retryable ? 'PROCESSING' : (error.code.includes('stock_conflict') || error.code.includes('manual_review') ? 'REVIEW' : 'FAILED');
            queued.error = error.message;
            if (retryable) break;
            index++;
            continue;
          }
          // The server may have committed before a connection failed. Keep UUID and payload,
          // then query the operation status before any retry on the next run.
          queued.status = 'PROCESSING';
          queued.error = error instanceof Error ? error.message : 'Connexion Core interrompue.';
          throw error;
        }
        this.persist();
      }
      // Pull the tenant/branch Cargo snapshot after queued writes have been acknowledged.
      const cargoSnapshot = await coreCargoPull(ctx.tenantId, ctx.branchId);
      if (cargoSnapshot.success && Array.isArray(cargoSnapshot.packages)) {
        const pendingCargoIds = new Set(this.state.offlineQueue.filter(item => item.type === 'CARGO_PACKAGE_UPSERT').map(item => String((item.payload as CargoPackage).id)));
        const remoteIds = new Set<string>();
        for (const remote of cargoSnapshot.packages) {
          if (!remote || typeof remote.id !== 'string' || !remote.data || typeof remote.data !== 'object') continue;
          remoteIds.add(remote.id);
          if (pendingCargoIds.has(remote.id)) continue;
          const normalized = { ...(remote.data as unknown as CargoPackage), id: remote.id, syncStatus: 'SYNCED' as const };
          const at = this.state.cargoPackages.findIndex(item => item.id === remote.id);
          if (at < 0) this.state.cargoPackages.unshift(normalized);
          else this.state.cargoPackages[at] = normalized;
        }
        this.state.cargoPackages = this.state.cargoPackages.map(item => pendingCargoIds.has(item.id) ? item : (remoteIds.has(item.id) ? item : item));
      }
      // Import-Export uses its own idempotent record endpoint, separate from Cargo and sync/push.
      const importSnapshot = await coreImportExportPull(ctx.tenantId, ctx.branchId);
      if (importSnapshot.success && Array.isArray(importSnapshot.records)) {
        const pendingKeys = new Set(this.state.offlineQueue
          .filter(item => item.type === 'IMPORT_EXPORT_RECORD_UPSERT')
          .map(item => { const row = item.payload as {id?:string;type?:string}; return `${row.type}:${row.id}`; }));
        const collections: Record<string, keyof Pick<AppDatabaseState,'importSuppliers'|'importShipments'|'importExpenses'|'importTrackingEvents'|'importPayments'|'importDocuments'>> = {
          supplier:'importSuppliers', shipment:'importShipments', expense:'importExpenses', tracking:'importTrackingEvents', payment:'importPayments', document:'importDocuments',
        };
        for (const remote of importSnapshot.records) {
          const collection = collections[remote.type];
          if (!collection || !remote.id || pendingKeys.has(`${remote.type}:${remote.id}`)) continue;
          const rows = this.state[collection] as Array<{id:string}>;
          const at = rows.findIndex(row => row.id === remote.id);
          if (remote.data && (remote.data as Record<string,unknown>)._deletedAt) {
            if (at >= 0) rows.splice(at, 1);
          } else {
            const normalized = { ...remote.data, id: remote.id } as {id:string};
            if (at >= 0) rows[at] = normalized;
            else rows.unshift(normalized);
          }
        }
      }
      const pending = this.state.offlineQueue.length;
      this.state.syncInfo = { status: pending ? 'ERROR' : 'SYNCED', lastSyncTime: pending ? this.state.syncInfo.lastSyncTime : new Date().toISOString(), pendingCount: pending,
        ...(pending ? { errorMessage: 'Des opérations restent en attente ou nécessitent une résolution.' } : {}) };
      this.persist();
      return pending === 0;
    } catch (error) {
      this.state.syncInfo = { status: 'ERROR', lastSyncTime: this.state.syncInfo.lastSyncTime, pendingCount: this.state.offlineQueue.length,
        errorMessage: error instanceof Error ? error.message : 'Synchronisation Core impossible.' };
      this.persist();
      return false;
    } finally { this.isSyncing = false; this.notify(); if(typeof window!=='undefined')window.dispatchEvent?.(new Event('bta-core-sync-finished')); }
  }

  private toCoreOperationType(type: string): string {
    const map: Record<string, string> = {
      SALE_CREATE: 'sale_create', PURCHASE_CREATE: 'purchase_create', EXPENSE_CREATE: 'expense_create',
      STOCK_ADJUSTMENT: 'stock_adjustment', DEBT_PAYMENT: 'debt_payment', SALE_REFUND: 'sale_refund',
      CATEGORY_CREATE: 'category_create', CATEGORY_UPDATE: 'category_update', PRODUCT_CREATE: 'product_create', PRODUCT_UPDATE: 'product_update', PRODUCT_ARCHIVE: 'product_archive',
      CUSTOMER_CREATE: 'customer_create', CUSTOMER_UPDATE: 'customer_update', SUPPLIER_CREATE: 'supplier_create', SUPPLIER_UPDATE: 'supplier_update',
    };
    const result = map[type];
    if (!result) throw new CoreApiError(400, 'bta_unsupported_local_operation', `Opération locale ${type} sans endpoint Core.`);
    return result;
  }

  private async toCorePayload(type: string, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ctx = this.coreContext!;
    const idOf = async (entity: string, local: unknown, optional = false): Promise<number | undefined> => {
      if (local === undefined || local === null || local === '') return undefined;
      if (typeof local !== 'string') throw new CoreApiError(400, 'bta_local_id_invalid', `ID local ${entity} invalide.`);
      const id = await getServerId(ctx.tenantId, entity, local);
      if (!id) throw new CoreApiError(409, 'bta_id_mapping_missing', `${entity} local non encore lié à un ID Core.`);
      return id ?? undefined;
    };
    const branch_id = ctx.branchId;
    if (type === 'SALE_CREATE') {
      const sale = raw as unknown as Sale;
      const currency = sale.currency ?? 'USD';
      const factor = currency === 'CDF' ? sale.exchangeRate : 1;
      if (!Number.isFinite(factor) || factor <= 0) throw new Error('Taux de change invalide.');
      const items = await Promise.all(sale.items.map(async item => ({ product_id: await idOf('products', item.productId), quantity: item.quantity, unit_price: item.unitPriceUSD * factor })));
      const customer_id = await idOf('customers', sale.customerId, true);
      return { branch_id, customer_id, reference: sale.invoiceNumber, currency, exchange_rate: sale.exchangeRate, items, discount: sale.discountUSD * factor, paid: sale.amountPaidUSD * factor, payment_method: this.corePaymentMethod(sale.paymentMethod), payment_reference: sale.invoiceNumber, notes: sale.notes, _local_record_id: sale.id };
    }
    if (type === 'PURCHASE_CREATE') {
      const purchase = raw as unknown as Purchase;
      const supplier_id = await idOf('suppliers', purchase.supplierId);
      const items = await Promise.all(purchase.items.map(async item => ({ product_id: await idOf('products', item.productId), quantity: item.quantity, unit_cost: item.buyPriceUSD })));
      if (purchase.status !== 'COMPLETED') throw new CoreApiError(409, 'bta_local_draft_unsupported', 'Les achats en brouillon restent locaux; Core crée uniquement des achats reçus.');
      return { branch_id, supplier_id, reference: purchase.purchaseNumber, currency: 'USD', exchange_rate: purchase.exchangeRate, items, fees: purchase.additionalFeesUSD, paid: purchase.amountPaidUSD, payment_method: this.corePaymentMethod(purchase.paymentMethod), payment_reference: purchase.purchaseNumber, notes: '', _local_record_id: purchase.id };
    }
    if (type === 'EXPENSE_CREATE') {
      const expense = raw as unknown as Expense;
      return { branch_id, category: expense.category, description: expense.description || expense.title, amount: expense.amountUSD, currency: 'USD', exchange_rate: expense.exchangeRate, payment_method: 'CASH', receipt_url: '', _local_record_id: expense.id };
    }
    if (type === 'STOCK_ADJUSTMENT') {
      const product_id = await idOf('products', raw.productId);
      return { branch_id, product_id, quantity_delta: raw.quantity_delta ?? raw.quantity, expected_quantity: raw.expected_quantity, reason: raw.reason ?? 'Ajustement BTA', _local_record_id: raw.id };
    }
    if (type === 'DEBT_PAYMENT') {
      const debt_id = await idOf('debts', raw.debtId);
      return { debt_id, amount: raw.amount, method: this.corePaymentMethod(raw.paymentMethod as PaymentMethod), reference: raw.reference ?? raw.id, _local_record_id: raw.id };
    }
    if (type === 'CATEGORY_CREATE') {
      const parent_id = await idOf('categories', raw.parentId, true);
      return { branch_id: ctx.branchId, name: raw.name, parent_id, description: raw.description ?? '', _local_record_id: raw.id };
    }
    if (type === 'CATEGORY_UPDATE') {
      return { branch_id, category_id: await idOf('categories', raw.id), name: raw.name, description: raw.description ?? '' };
    }
    if (type === 'PRODUCT_ARCHIVE') return { branch_id, product_id: await idOf('products', raw.id), status: 'ARCHIVED' };
    if (type === 'PRODUCT_CREATE' || type === 'PRODUCT_UPDATE') {
      const product = raw as unknown as Product;
      if (product.photoUrl?.startsWith('data:')) {
        const original = product.photoUrl;
        const {coreUploadProductImage} = await import('../core/api');
        const remote = await coreUploadProductImage(ctx.tenantId,ctx.branchId,original);
        const current = this.state.products.find(item => item.id === product.id);
        if (current?.photoUrl === original) current.photoUrl = remote;
        product.photoUrl = remote;
        this.persist(); this.notify();
        await this.flushDurableAndWait();
      }
      const category_id = await idOf('categories', product.categoryId, true);
      const fields: Record<string, unknown> = {
        sku: product.sku, barcode: product.barcode, name: product.name, description: product.description,
        unit: product.unit === 'pcs' ? 'piece' : product.unit, purchase_price: product.buyPriceUSD,
        sale_price: product.sellPriceUSD, currency: 'USD', image_url: product.photoUrl,
        track_stock: true, min_stock: product.minStock, category_id,
      };
      if (type === 'PRODUCT_CREATE') return { ...fields, branch_id: ctx.branchId, initial_stock: product.currentStock, _local_record_id: product.id };
      const product_id = await idOf('products', product.id);
      return { ...fields, product_id, branch_id: ctx.branchId, _local_record_id: product.id };
    }
    if (type === 'CUSTOMER_CREATE') {
      const customer = raw as unknown as Customer;
      return { branch_id: ctx.branchId, name: customer.name, phone: customer.phone, email: customer.email, address: [customer.address, customer.city].filter(Boolean).join(', '), notes: customer.notes ?? '', credit_limit: customer.creditLimitUSD, _local_record_id: customer.id };
    }
    if (type === 'CUSTOMER_UPDATE') {
      const customer = raw as unknown as Customer;
      return { branch_id: ctx.branchId, customer_id: await idOf('customers', customer.id), name: customer.name, phone: customer.phone, email: customer.email, address: [customer.address, customer.city].filter(Boolean).join(', '), notes: customer.notes ?? '', credit_limit: customer.creditLimitUSD };
    }
    if (type === 'SUPPLIER_CREATE') {
      const supplier = raw as unknown as Supplier;
      return { branch_id: ctx.branchId, name: supplier.companyName, phone: supplier.phone, email: supplier.email, address: supplier.address, notes: [supplier.contactName, supplier.suppliedProducts].filter(Boolean).join(' · '), _local_record_id: supplier.id };
    }
    if (type === 'SUPPLIER_UPDATE') {
      const supplier = raw as unknown as Supplier;
      return { branch_id: ctx.branchId, supplier_id: await idOf('suppliers', supplier.id), name: supplier.companyName, phone: supplier.phone, email: supplier.email, address: supplier.address, notes: [supplier.contactName, supplier.suppliedProducts].filter(Boolean).join(' · ') };
    }
    return raw;
  }

  private corePaymentMethod(method?: PaymentMethod): string {
    if (method === 'BANK_TRANSFER') return 'BANK';
    if (method === 'CREDIT' || method === 'PARTIAL') return 'CASH';
    return method || 'CASH';
  }

  private async applyCoreAck(queued: AppDatabaseState['offlineQueue'][number], result: Record<string, unknown>): Promise<void> {
    const payload = queued.payload as Record<string, unknown>;
    const localId = String(payload.id ?? payload._local_record_id ?? '');
    const entityMap: Record<string,string> = { SALE_CREATE:'sales', PURCHASE_CREATE:'purchases', EXPENSE_CREATE:'expenses', CATEGORY_CREATE:'categories', CATEGORY_UPDATE:'categories', PRODUCT_CREATE:'products', PRODUCT_UPDATE:'products', PRODUCT_ARCHIVE:'products', CUSTOMER_CREATE:'customers', CUSTOMER_UPDATE:'customers', SUPPLIER_CREATE:'suppliers', SUPPLIER_UPDATE:'suppliers' };
    const entity = entityMap[queued.type] ?? '';
    const record = result.sale as Record<string, unknown> | undefined;
    const named = (result.category ?? result.product ?? result.customer ?? result.supplier ?? result.purchase) as Record<string,unknown> | undefined;
    const serverId = Number(record?.id ?? named?.id ?? result.purchase_id ?? result.expense_id ?? result.sale_id);
    if (entity && queued.type.endsWith('_CREATE') && (!localId || !Number.isSafeInteger(serverId) || serverId <= 0)) throw new CoreApiError(409, 'bta_sync_manual_review', 'Accusé Core sans identifiant de ressource; opération conservée.');
    if (entity && localId && Number.isSafeInteger(serverId) && serverId > 0) await mapServerId(this.coreContext!.tenantId, entity, localId, serverId);
    if (queued.type === 'SALE_CREATE' && record?.debt_id) {
      const sale = this.state.sales.find(item => item.id === localId);
      const debt = sale && this.state.debts.find(item => item.referenceInvoice === sale.invoiceNumber && item.type === 'CUSTOMER');
      if (debt) await mapServerId(this.coreContext!.tenantId, 'debts', debt.id, Number(record.debt_id));
    }
    if (entity) {
      if (entity === 'sales' || entity === 'purchases' || entity === 'expenses') {
        const rows = this.state[entity] as Array<{id:string; syncStatus:'SYNCED'|'PENDING'|'ERROR'}>;
        const row = rows.find(x => x.id === localId);
        if (row) row.syncStatus = 'SYNCED';
      }
    }
    this.state.coreSyncHistory.unshift({ id: queued.id, type: queued.type, status: 'DONE', timestamp: new Date().toISOString() });
    this.state.coreSyncHistory = this.state.coreSyncHistory.slice(0, 500);
  }

  public getCoreOperationHistory() { return this.state.coreSyncHistory; }
  public getCorePendingOperations() { return this.state.offlineQueue.map(item => ({ id:item.id, type:item.type, timestamp:item.timestamp, status:item.status ?? 'PENDING', error:item.error })); }
  public retryFailedCoreOperation(id: string, correctedPayload?: unknown, confirmedNotApplied = false) {
    const op = this.state.offlineQueue.find(item => item.id === id);
    if (!op || (op.status !== 'FAILED' && op.status !== 'REVIEW')) throw new Error('Cette opération ne peut pas être résolue depuis cet état.');
    if (op.status === 'REVIEW' && !confirmedNotApplied) throw new Error('Vérifiez dans Core que l’opération n’a pas été appliquée avant de la recréer.');
    this.state.coreSyncHistory.unshift({ id: op.id, type: op.type, status: op.status, timestamp: new Date().toISOString(), error: op.error });
    this.state.coreSyncHistory = this.state.coreSyncHistory.slice(0, 500);
    const retry = { ...op, id: generateUUID(), payload: correctedPayload ?? op.payload, corePayload: undefined, timestamp: new Date().toISOString(), status: 'PENDING' as const, attempts: 0, error: undefined };
    this.state.offlineQueue = this.state.offlineQueue.filter(item => item.id !== id);
    this.state.offlineQueue.push(retry);
    this.state.syncInfo.pendingCount = this.state.offlineQueue.length;
    this.persist();
    if (this.coreContext && this.state.syncInfo.status !== 'OFFLINE') void this.triggerSync();
  }

  private scheduleBackToOnline(ms: number) {
    setTimeout(() => {
      if (this.state.syncInfo.status === 'SYNCED') {
        this.state.syncInfo.status = 'ONLINE';
        this.notify();
      }
    }, ms);
  }

  /** Queues a record for the server (only when a server is configured). */
  private enqueue<T extends { id: string }>(type: string, payload: T) {
    if (this.state.cloud && !this.coreContext) return; // legacy cloud diff mode is used only without an authenticated Core context
    if (!SYNC_ENABLED && !this.coreContext) return;
    this.state.offlineQueue.push({
      id: generateUUID(),
      type,
      payload: JSON.parse(JSON.stringify(payload)),
      timestamp: new Date().toISOString(),
    });
    this.state.syncInfo.pendingCount = this.state.offlineQueue.length;
  }

  private syncStatusForNewRecord(): 'SYNCED' | 'PENDING' {
    // Local-only mode: nothing to wait for. Server mode: pending until the server confirms.
    return SYNC_ENABLED || this.state.cloud || this.coreContext ? 'PENDING' : 'SYNCED';
  }

  private afterWrite() {
    this.persist();
    if ((SYNC_ENABLED || this.state.cloud || this.coreContext) && this.state.syncInfo.status !== 'OFFLINE') {
      void this.triggerSync();
    }
  }

  // Getters
  public getState(): AppDatabaseState {
    return this.state;
  }

  private coreSnapshotKey(tenantId: number, branchId: number) { return `snapshot:${tenantId}:${branchId}`; }
  private coreBackupKey(tenantId: number, branchId: number) { return `pre-core:${tenantId}:${branchId}`; }

  public async applyCoreSnapshot(snapshot: CoreBootstrapSnapshot, source: 'server'|'cache'): Promise<void> {
    if (this.isSyncing || this.isBootstrapping) throw new Error('Synchronisation ou chargement en cours. Réessayez après sa fin.');
    this.isBootstrapping = true;
    try { await this.mergeCoreSnapshot(snapshot, source); }
    finally { this.isBootstrapping = false; }
  }

  private async mergeCoreSnapshot(snapshot: CoreBootstrapSnapshot, source: 'server'|'cache'): Promise<void> {
    await this.initialization;
    const { tenantId, branchId } = snapshot;
    const backupKey = this.coreBackupKey(tenantId, branchId);
    if (!(await localforage.getItem(backupKey))) {
      // Keep the pre-Core local data recoverable on-device before replacing seeded/demo lists.
      const backup = {
        offlineQueue: this.state.offlineQueue, coreSyncHistory: this.state.coreSyncHistory, coreScope: this.state.coreScope,
        savedAt: new Date().toISOString(), categories: this.state.categories, products: this.state.products,
        customers: this.state.customers, suppliers: this.state.suppliers, sales: this.state.sales,
        purchases: this.state.purchases, stockMovements: this.state.stockMovements, expenses: this.state.expenses,
        debts: this.state.debts, reservations: this.state.reservations, reservationCancellations: this.state.reservationCancellations,
        reservationPayments: this.state.reservationPayments, reservationDeliveries: this.state.reservationDeliveries,
        stockDamages: this.state.stockDamages, freeIssues: this.state.freeIssues,
        importSuppliers: this.state.importSuppliers, importShipments: this.state.importShipments, importExpenses: this.state.importExpenses,
        importTrackingEvents: this.state.importTrackingEvents, importPayments: this.state.importPayments, importDocuments: this.state.importDocuments,
      };
      await localforage.setItem(backupKey, backup);
    }
    const businessKeys = ['categories','products','customers','suppliers','sales','purchases','stockMovements','expenses','debts','reservations','reservationCancellations','reservationPayments','reservationDeliveries','stockDamages','freeIssues','importSuppliers','importShipments','importExpenses','importTrackingEvents','importPayments','importDocuments','offlineQueue','coreSyncHistory'] as const;
    const previous = this.state.coreScope;
    const scopeChanged = !previous || previous.tenantId !== tenantId || previous.branchId !== branchId;
    if (this.isSyncing) throw new Error('Synchronisation en cours. Réessayez après sa fin.');
    if (scopeChanged) {
      if (previous) {
        const archive = { ...Object.fromEntries(businessKeys.map(key => [key, this.state[key]])), coreActorId: this.state.coreActorId };
        await localforage.setItem(`core-state:${previous.tenantId}:${previous.branchId}`, archive);
      }
      const restored = await localforage.getItem<Partial<AppDatabaseState>>(`core-state:${tenantId}:${branchId}`);
      for (const key of businessKeys) (this.state as unknown as Record<string,unknown>)[key] = restored?.[key] ?? [];
      this.state.coreActorId = restored?.coreActorId;
      this.coreContext = null;
      this.state.coreScope = { tenantId, branchId };
    }
    await localforage.setItem(this.coreSnapshotKey(tenantId, branchId), snapshot);

    // Reuse each acknowledged local ID so sales, debts and queued references remain valid.
    snapshot = JSON.parse(JSON.stringify(snapshot)) as CoreBootstrapSnapshot;
    for (const [entity, kind] of [['categories','category'], ['products','product'], ['customers','customer'], ['suppliers','supplier']] as const) {
      const translations = new Map<string,string>();
      for (const item of snapshot[entity]) {
        const remoteId = item.id;
        const serverId = Number(remoteId.split('-').at(-1));
        const stableId = await getLocalId(tenantId, entity, serverId) ?? remoteId;
        translations.set(remoteId, stableId);
        item.id = stableId;
        await mapServerId(tenantId, entity, stableId, serverId);
      }
      if (kind === 'category') for (const item of snapshot.products) item.categoryId = translations.get(item.categoryId) ?? item.categoryId;
      if (kind === 'product') for (const item of snapshot.stockMovements) item.productId = translations.get(item.productId) ?? item.productId;
    }
    for (const debt of snapshot.debts ?? []) {
      const serverId = Number(debt.id.split('-').at(-1));
      if (!Number.isSafeInteger(serverId) || serverId <= 0) continue;
      debt.id = await getLocalId(tenantId, 'debts', serverId) ?? debt.id;
      await mapServerId(tenantId, 'debts', debt.id, serverId);
      const customerServerId = Number(debt.partyId.split('-').at(-1));
      if (Number.isSafeInteger(customerServerId) && customerServerId > 0) {
        debt.partyId = await getLocalId(tenantId, 'customers', customerServerId) ?? debt.partyId;
      }
    }

    const pendingByType = new Map<string, Set<string>>();
    for (const op of this.state.offlineQueue) {
      if ((op.status as string | undefined) === 'DONE') continue;
      const payload = op.payload as Record<string, unknown>;
      const id = typeof payload.id === 'string' ? payload.id : typeof payload._local_record_id === 'string' ? payload._local_record_id : '';
      if (!id) continue;
      const bucket = pendingByType.get(op.type) ?? new Set<string>(); bucket.add(id); pendingByType.set(op.type, bucket);
    }
    const keepPending = async <T extends {id:string}>(remote: T[], local: T[], operations: string[], entity?: string): Promise<T[]> => {
      const keep = new Set(operations.flatMap(type => [...(pendingByType.get(type) ?? [])]));
      const result = [...remote];
      for (const localItem of local) {
        if (!keep.has(localItem.id)) continue;
        const mappedId = entity ? await getServerId(tenantId, entity, localItem.id) : null;
        const serverKind = entity === 'categories' ? 'category' : entity?.slice(0, -1);
        const serverLocalId = mappedId ? (await getLocalId(tenantId, entity!, mappedId) ?? `core-${serverKind}-${mappedId}`) : '';
        const existing = result.findIndex(row => row.id === localItem.id || (!!serverLocalId && row.id === serverLocalId));
        if (existing >= 0) result[existing] = localItem;
        else result.unshift(localItem);
      }
      return result;
    };
    this.state.categories = await keepPending(snapshot.categories, this.state.categories, ['CATEGORY_CREATE','CATEGORY_UPDATE'], 'categories');
    const pendingStock = new Set<string>();
    for (const op of this.state.offlineQueue) {
      const payload = op.payload as {productId?: string; items?: Array<{productId:string}>};
      if (op.type === 'STOCK_ADJUSTMENT' && payload.productId) pendingStock.add(payload.productId);
      if (op.type === 'SALE_CREATE' || op.type === 'PURCHASE_CREATE') for (const item of payload.items ?? []) pendingStock.add(item.productId);
    }
    for (const product of snapshot.products) {
      if (pendingStock.has(product.id)) {
        const local = this.state.products.find(item => item.id === product.id);
        if (local) product.currentStock = local.currentStock;
      }
    }
    const archiving = new Set(this.state.offlineQueue.filter(op => op.type === 'PRODUCT_ARCHIVE' && op.status !== 'FAILED' && op.status !== 'REVIEW').map(op => (op.payload as Product).id));
    this.state.products = await keepPending(snapshot.products.filter(item => !archiving.has(item.id)), this.state.products, ['PRODUCT_CREATE','PRODUCT_UPDATE'], 'products');
    this.state.customers = await keepPending(snapshot.customers, this.state.customers, ['CUSTOMER_CREATE','CUSTOMER_UPDATE'], 'customers');
    this.state.suppliers = await keepPending(snapshot.suppliers, this.state.suppliers, ['SUPPLIER_CREATE','SUPPLIER_UPDATE'], 'suppliers');
    this.state.stockMovements = await keepPending(snapshot.stockMovements, this.state.stockMovements, ['STOCK_ADJUSTMENT']);
    const pendingDebtIds = new Set<string>();
    const pendingSaleReferences = new Set<string>();
    for (const op of this.state.offlineQueue) {
      if (op.status === 'FAILED' || op.status === 'REVIEW') continue;
      const payload = op.payload as Record<string, unknown>;
      if (op.type === 'DEBT_PAYMENT' && typeof payload.debtId === 'string') pendingDebtIds.add(payload.debtId);
      if (op.type === 'SALE_CREATE' && typeof payload.invoiceNumber === 'string') pendingSaleReferences.add(payload.invoiceNumber);
    }
    const mergedDebts = [...(snapshot.debts ?? [])];
    for (const localDebt of this.state.debts) {
      const preserve = localDebt.type === 'SUPPLIER' || pendingDebtIds.has(localDebt.id) || pendingSaleReferences.has(localDebt.referenceInvoice);
      if (!preserve) continue;
      const index = mergedDebts.findIndex(remote => remote.id === localDebt.id || (remote.type === localDebt.type && remote.referenceInvoice === localDebt.referenceInvoice));
      if (index >= 0) mergedDebts[index] = localDebt;
      else mergedDebts.unshift(localDebt);
    }
    this.state.debts = mergedDebts;
    // Keep each customer's summary consistent with the merged debt ledger, including protected offline repayments.
    const customerDebtTotals = new Map<string, number>();
    for (const debt of mergedDebts) {
      if (debt.type !== 'CUSTOMER') continue;
      customerDebtTotals.set(debt.partyId, (customerDebtTotals.get(debt.partyId) ?? 0) + debt.remainingBalanceUSD);
    }
    for (const customer of this.state.customers) {
      if (customerDebtTotals.has(customer.id)) customer.debtBalanceUSD = Math.round((customerDebtTotals.get(customer.id)! + Number.EPSILON) * 100) / 100;
    }
    // Sales and debt ledgers are now refreshed from confirmed Core records; local pending entries stay protected above.
    this.state.syncInfo = {
      ...this.state.syncInfo, status: source === 'cache' ? 'OFFLINE' : 'SYNCED', lastSyncTime: snapshot.downloadedAt,
      pendingCount: this.state.offlineQueue.length,
      ...(source === 'cache' ? { errorMessage: 'Données Core locales : serveur indisponible, synchronisation suspendue.' } : { errorMessage: undefined }),
    };
    this.persist();
    await this.flushDurableAndWait();
  }

  public async refreshSharedCoreData(expected:{tenantId:number;branchId:number;userId:number},active:()=>boolean):Promise<boolean> {
    const valid=()=>active()&&this.sessionUserId!==null&&this.state.coreActorId===expected.userId&&this.coreContext?.tenantId===expected.tenantId&&this.coreContext?.branchId===expected.branchId;
    if(!valid()||this.isSyncing||this.isBootstrapping||this.state.syncInfo.status==='OFFLINE')return false;
    if(this.state.offlineQueue.length)await this.triggerSync();
    if(!valid()||this.isSyncing)return false;
    const revision=this.rev;
    const {fetchSharedSales,mergeSharedSales}=await import('../core/shared');
    const permissions=[...this.corePermissions];
    let historyError:unknown;
    const [snapshot,sales]=await Promise.all([
      fetchCoreBootstrap(expected.tenantId,expected.branchId,this.state.settings.exchangeRate,permissions),
      permissions.includes('sales.read')?fetchSharedSales(expected.tenantId,expected.branchId).catch(e=>{historyError=e;return null;}):Promise.resolve(null),
    ]);
    if(!valid()||revision!==this.rev||this.isSyncing||this.isBootstrapping)return false;
    await this.applyCoreSnapshot(snapshot,'server');
    if(!valid())return false;
    if(sales)this.state.sales=mergeSharedSales(sales,this.state.sales,this.state.offlineQueue);
    if(this.state.offlineQueue.length||historyError)this.state.syncInfo.status='ERROR';
    if(historyError)this.state.syncInfo.errorMessage=String(historyError);
    this.persist();this.notify();return !historyError;
  }

  public async loadCachedCoreSnapshot(tenantId: number, branchId: number): Promise<CoreBootstrapSnapshot | null> {
    return localforage.getItem<CoreBootstrapSnapshot>(this.coreSnapshotKey(tenantId, branchId));
  }

  public async bootstrapCoreData(tenantId: number, branchId: number, permissions: string[]): Promise<'server'|'cache'> {
    await this.initialization;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const cached = await this.loadCachedCoreSnapshot(tenantId, branchId);
      if (!cached) throw new Error('Aucune donnée Core locale pour cet établissement. Connectez-vous à Internet pour le premier chargement.');
      await this.applyCoreSnapshot(cached, 'cache');
      this.corePermissions = new Set(permissions);
      return 'cache';
    }
    const revision = this.rev;
    try {
      const snapshot = await fetchCoreBootstrap(tenantId, branchId, this.state.settings.exchangeRate, permissions);
      if (revision !== this.rev) throw new Error('Les données locales ont changé pendant le chargement. Réessayez.');
      await this.applyCoreSnapshot(snapshot, 'server');
      this.corePermissions = new Set(permissions);
      return 'server';
    } catch (error) {
      if (revision !== this.rev) throw error;
      if (error instanceof CoreApiError && (error.status === 401 || error.status === 403)) throw error;
      const cached = await this.loadCachedCoreSnapshot(tenantId, branchId);
      if (!cached) throw error;
      await this.applyCoreSnapshot(cached, 'cache');
      this.corePermissions = new Set(permissions);
      return 'cache';
    }
  }

  public getSettings(): CompanySettings {
    return this.state.settings;
  }

  public getCurrentUser(): User {
    return this.state.currentUser;
  }

  // ---------------------------------------------------------------------
  // Authentication (PIN) & authorisation (roles)
  // ---------------------------------------------------------------------
  public isAuthenticated(): boolean {
    return this.sessionUserId !== null;
  }

  /** Core identity is held in memory; local business data and PIN profiles remain untouched. */
  public activateCoreUser(core: { id: number; name: string; email: string; role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER'; tenantId: number; branchId: number }) {
    const role: UserRole = core.role === 'OWNER' || core.role === 'ADMIN' ? 'ADMIN' : core.role === 'MANAGER' ? 'GESTIONNAIRE' : 'CASHIER';
    const existing = this.state.users.find(user => user.id === `core:${core.id}`);
    const user: User = { ...existing, id: `core:${core.id}`, name: core.name, email: core.email, role, phone: existing?.phone ?? '', active: true };
    this.state.users = [...this.state.users.filter(item => item.id !== user.id), user];
    this.sessionUserId = user.id;
    this.state.currentUser = user;
    const previousScope = this.coreContext ?? this.state.coreScope;
    const changedScope = previousScope
      ? previousScope.tenantId !== core.tenantId || previousScope.branchId !== core.branchId
      : this.state.offlineQueue.length > 0;
    this.coreContext = { tenantId: core.tenantId, branchId: core.branchId };
    this.state.coreScope = { ...this.coreContext };
    const changedActor = this.state.coreActorId !== core.id;
    this.state.coreActorId = core.id;
    if ((changedScope || changedActor) && this.state.offlineQueue.some(op => op.status !== 'FAILED' && op.status !== 'REVIEW')) {
      this.state.offlineQueue.forEach(op => { if (op.status !== 'FAILED' && op.status !== 'REVIEW') { op.status = 'REVIEW'; op.error = 'Entreprise, établissement ou utilisateur Core changé; rattachement manuel requis.'; } });
    } else if (this.state.offlineQueue.length && (typeof navigator === 'undefined' || navigator.onLine)) {
      void this.triggerSync();
    }
    this.persist();
    this.notify();
  }

  public logout() {
    this.sessionUserId = null;
    this.notify();
  }

  private readLockouts(): Record<string, { count: number; until: number; level: number }> {
    try {
      return JSON.parse(localStorage.getItem(LOCKOUT_KEY) || '{}');
    } catch {
      return {};
    }
  }

  private writeLockouts(v: Record<string, { count: number; until: number; level: number }>) {
    try {
      localStorage.setItem(LOCKOUT_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }

  /** Remaining lock time in ms for a user (0 = not locked). */
  public getLockoutRemainingMs(userId: string): number {
    const l = this.readLockouts()[userId];
    return l && l.until > Date.now() ? l.until - Date.now() : 0;
  }

  /**
   * Checks the PIN. After 5 wrong attempts the account is locked (30s, then x2 each time).
   */
  public attemptLogin(
    userId: string,
    candidatePin: string
  ): { ok: boolean; error?: string; lockedMs?: number } {
    const user = this.getUserById(userId);
    if (!user || user.active === false) return { ok: false, error: 'Compte introuvable ou désactivé.' };

    const remaining = this.getLockoutRemainingMs(userId);
    if (remaining > 0) {
      return {
        ok: false,
        lockedMs: remaining,
        error: `Trop de tentatives. Réessayez dans ${Math.ceil(remaining / 1000)} s.`,
      };
    }

    const lockouts = this.readLockouts();
    if (verifyPinSync(candidatePin, user.pinHash, user.pinSalt)) {
      delete lockouts[userId];
      this.writeLockouts(lockouts);
      // Upgrade legacy (single SHA-256) hashes to the stretched format
      if (user.pinHash && !user.pinHash.startsWith('v2$') && user.pinSalt) {
        user.pinHash = hashPinSync(candidatePin, user.pinSalt);
      }
      this.sessionUserId = user.id;
      this.state.currentUser = user;
      this.persist();
      return { ok: true };
    }

    const entry = lockouts[userId] || { count: 0, until: 0, level: 0 };
    entry.count += 1;
    if (entry.count >= MAX_PIN_ATTEMPTS) {
      entry.until = Date.now() + LOCKOUT_BASE_MS * Math.pow(2, Math.min(entry.level, 6));
      entry.level += 1;
      entry.count = 0;
      lockouts[userId] = entry;
      this.writeLockouts(lockouts);
      return { ok: false, lockedMs: entry.until - Date.now(), error: 'Trop de tentatives. Compte verrouillé temporairement.' };
    }
    lockouts[userId] = entry;
    this.writeLockouts(lockouts);
    return { ok: false, error: `Code PIN incorrect. ${MAX_PIN_ATTEMPTS - entry.count} essai(s) restant(s).` };
  }

  /** True if the logged-in user still uses one of the well-known demo PINs. */
  public currentUserHasDefaultPin(): boolean {
    const u = this.state.currentUser;
    return !!this.sessionUserId && isSeedDefaultPin(u.pinHash, u.pinSalt);
  }

 private currentRole(): UserRole | null {
  return this.sessionUserId ? this.state.currentUser.role : null;
}
  private requireAdmin() {
    if (this.isBootstrapping) throw new Error('Chargement des données en cours. Réessayez après sa fin.');
    if (!ADMIN_ROLES.includes(this.currentRole())) throw new Error('Action réservée à l’administrateur.');
  }

  private requireCorePermission(permission: string) {
    if (this.coreContext && !this.corePermissions.has(permission)) throw new Error('Permission Core refusée pour cet établissement: ' + permission);
  }

  private requireManager() {
    if (this.isBootstrapping) throw new Error('Chargement des données en cours. Réessayez après sa fin.');
    if (!MANAGER_ROLES.includes(this.currentRole())) throw new Error('Action réservée aux gestionnaires et administrateurs.');
  }

  private requireLoggedIn() {
    if (this.isBootstrapping) throw new Error('Chargement des données en cours. Réessayez après sa fin.');
    if (!this.sessionUserId) throw new Error('Session expirée. Reconnectez-vous.');
  }

  public getUsers(): User[] {
    return this.state.users;
  }

  public isBootstrapRequired(): boolean {
    return !this.state.users.some((u) => u.role === 'ADMIN' && !!u.pinHash && !!u.pinSalt);
  }

  /** First-run bootstrap: available only while no local administrator credential exists. */
  public initializeFirstAdminPin(userId: string, pin: string) {
    if (!this.isBootstrapRequired()) throw new Error('Le compte administrateur est déjà initialisé.');
    if (isWeakPin(pin)) throw new Error('Choisissez un PIN de 4 à 8 chiffres qui ne soit pas trivial.');
    let admin = this.getUserById(userId);
    if (!admin) throw new Error('Profil administrateur introuvable.');
    if (admin.role !== 'ADMIN' || admin.active === false) throw new Error('Un profil administrateur actif est requis.');
    const salt = generateSalt(16);
    this.updateUser({ ...admin, pinSalt: salt, pinHash: hashPinSync(pin.trim(), salt) });
  }

  public getUserById(id: string): User | undefined {
    return this.state.users.find((u) => u.id === id);
  }

  /**
   * First-device bootstrap: explicitly bind a Firebase-authenticated UID
   * to the existing local administrator. This does not grant Firestore access
   * by itself; server-side company membership and security rules are still required.
   */
  public linkFirebaseUid(userId: string, firebaseUid: string, currentPin: string): void {
    const user = this.getUserById(userId);
    if (!user) throw new Error('Utilisateur local introuvable.');
    if (!firebaseUid.trim()) throw new Error('Identifiant Firebase manquant.');
    if (!verifyPinSync(currentPin, user.pinHash, user.pinSalt)) {
      throw new Error('Le PIN local est incorrect.');
    }

    const alreadyUsed = this.state.users.find(
      (candidate) => candidate.id !== userId && candidate.firebaseUid === firebaseUid
    );
    if (alreadyUsed) {
      throw new Error('Ce compte Firebase est déjà associé à un autre utilisateur local.');
    }
    this.updateUser({ ...user, firebaseUid: firebaseUid.trim() });
  }

  public verifyUserPinWithLockout(
    userId: string,
    candidatePin: string,
  ): { ok: boolean; error?: string; lockedMs?: number } {
    const user = this.getUserById(userId);
    if (!user || user.active === false) {
      return { ok: false, error: 'Compte introuvable ou désactivé.' };
    }

    const remaining = this.getLockoutRemainingMs(userId);
    if (remaining > 0) {
      return {
        ok: false,
        lockedMs: remaining,
        error: `Trop de tentatives. Réessayez dans ${Math.ceil(remaining / 1000)} s.`,
      };
    }

    const lockouts = this.readLockouts();

    if (verifyPinSync(candidatePin, user.pinHash, user.pinSalt)) {
      delete lockouts[userId];
      this.writeLockouts(lockouts);

      if (user.pinHash && !user.pinHash.startsWith('v2$') && user.pinSalt) {
        user.pinHash = hashPinSync(candidatePin, user.pinSalt);
        this.updateUser(user);
      }

      return { ok: true };
    }

    const entry = lockouts[userId] || { count: 0, until: 0, level: 0 };
    entry.count += 1;

    if (entry.count >= MAX_PIN_ATTEMPTS) {
      entry.until = Date.now() + LOCKOUT_BASE_MS * Math.pow(2, Math.min(entry.level, 6));
      entry.level += 1;
      entry.count = 0;
      lockouts[userId] = entry;
      this.writeLockouts(lockouts);

      return {
        ok: false,
        lockedMs: entry.until - Date.now(),
        error: 'Trop de tentatives. Compte verrouillé temporairement.',
      };
    }

    lockouts[userId] = entry;
    this.writeLockouts(lockouts);

    return {
      ok: false,
      error: `Code PIN incorrect. ${MAX_PIN_ATTEMPTS - entry.count} essai(s) restant(s).`,
    };
  }

  public verifyUserPin(userId: string, candidatePin: string): boolean {
    const user = this.getUserById(userId);
    if (!user) return false;
    return verifyPinSync(candidatePin, user.pinHash, user.pinSalt);
  }

  /** Admin can change anyone's PIN; any user can change his own. */
  public changeUserPin(userId: string, newPin: string): boolean {
    this.requireLoggedIn();
    if (userId !== this.sessionUserId) this.requireAdmin();
    const user = this.getUserById(userId);
    if (!user || !newPin) return false;
    if (isWeakPin(newPin)) {
      throw new Error('PIN trop simple : 4 à 8 chiffres, pas de suite (1234), ni répétition (1111), ni PIN par défaut.');
    }
    const salt = generateSalt(16);
    this.updateUser({ ...user, pinSalt: salt, pinHash: hashPinSync(newPin.trim(), salt) });
    return true;
  }

  public addUser(user: Omit<User, 'id'>, initialPin?: string): User {
    this.requireAdmin();
    if (this.coreContext) throw new Error('Ce formulaire crée uniquement un profil local. Pour un autre téléphone, utilisez une invitation Core et un compte serveur ; ce parcours reste à intégrer dans BTA.');
    const name = (user.name || '').trim();
    if (!name) throw new Error('Le nom est obligatoire.');
    if (!initialPin || isWeakPin(initialPin)) {
      throw new Error('Définissez un PIN de 4 à 8 chiffres, non trivial (pas 1234, 1111, 0000...).');
    }
    const salt = generateSalt(16);
    const newUser: User = {
      ...user,
      name,
      id: generateUUID(),
      pinSalt: salt,
      pinHash: hashPinSync(initialPin.trim(), salt),
    };
    this.state.users = [...this.state.users, newUser];
    this.persist();
    return newUser;
  }

  private updateUser(user: User) {
    this.state.users = this.state.users.map((u) => (u.id === user.id ? user : u));
    if (this.state.currentUser.id === user.id) {
      this.state.currentUser = user;
    }
    this.persist();
  }

  /** Admin: edit name / e-mail / phone of an account. */
  public updateUserProfile(userId: string, profile: { name: string; email: string; phone: string }) {
    this.requireAdmin();
    const user = this.getUserById(userId);
    if (!user) throw new Error('Utilisateur introuvable.');
    const name = (profile.name || '').trim();
    if (!name) throw new Error('Le nom est obligatoire.');
    this.updateUser({ ...user, name, email: (profile.email || '').trim(), phone: (profile.phone || '').trim() });
  }

  /** Admin: delete an account. You cannot delete yourself, nor the last administrator. */
  public deleteUser(userId: string) {
    this.requireAdmin();
    if (userId === this.sessionUserId) throw new Error('Vous ne pouvez pas supprimer le compte avec lequel vous êtes connecté.');
    const target = this.getUserById(userId);
    if (!target) throw new Error('Utilisateur introuvable.');
    const remainingAdmins = this.state.users.filter((u) => u.id !== userId && ADMIN_ROLES.includes(u.role) && u.active !== false);
    if (remainingAdmins.length === 0) throw new Error('Il doit rester au moins un administrateur.');
    this.state.users = this.state.users.filter((u) => u.id !== userId);
    this.persist();
  }

  public updateSettings(settings: CompanySettings) {
    this.requireAdmin();
    if (!isNum(settings.exchangeRate) || settings.exchangeRate < 100 || settings.exchangeRate > 100000) {
      throw new Error('Taux de change invalide (1 USD = entre 100 et 100 000 FC).');
    }
    if (!settings.companyName || !settings.companyName.trim()) throw new Error('Le nom de l’entreprise est obligatoire.');
    const minutes = Number(settings.autoLogoutMinutes);
    this.state.settings = {
      ...settings,
      autoLogoutMinutes: Number.isFinite(minutes) && minutes >= 0 ? Math.min(minutes, 240) : 15,
    };
    this.persist();
  }

  // Category Operations
  public getCategories(): Category[] {
    return this.state.categories;
  }

  public addCategory(name: string, description: string, iconName = 'Folder', color = '#0284C7'): Category {
    this.requireManager();
    this.requireCorePermission('stock.manage');
    const newCat: Category = {
      id: `cat-${generateUUID().substring(0, 8)}`,
      name,
      description,
      iconName,
      color,
    };
    this.state.categories = [...this.state.categories, newCat];
    this.enqueue('CATEGORY_CREATE', newCat);
    this.afterWrite();
    return newCat;
  }

  public updateCategory(category: Category) {
    this.requireManager();
    this.requireCorePermission('stock.manage');
    this.state.categories = this.state.categories.map((c) => (c.id === category.id ? category : c));
    this.enqueue('CATEGORY_UPDATE', category);
    this.afterWrite();
  }

  public deleteCategory(categoryId: string): boolean {
    this.requireManager();
    this.requireCorePermission('stock.manage');
    const hasProducts = this.state.products.some((p) => p.categoryId === categoryId);
    if (hasProducts) {
      return false; // prevent deletion if attached to products
    }
    this.state.categories = this.state.categories.filter((c) => c.id !== categoryId);
    this.persist();
    return true;
  }

  // Product Operations
  public getProducts(): Product[] {
    return this.state.products;
  }

  /** Quantité encore bloquée pour les réservations non annulées. */
  public getReservedStock(productId: string): number {
    return r2(
      this.state.reservations
        .filter((reservation) => reservation.status !== 'CANCELLED')
        .flatMap((reservation) => reservation.items)
        .filter((item) => item.productId === productId && item.stockPolicy === 'BLOCK_STOCK')
        .reduce(
          (total, item) =>
            total + Math.max(0, item.quantityReserved - item.quantityDelivered),
          0
        )
    );
  }

  /** Stock physique moins les quantités réservées et non encore livrées. */
  public getAvailableStock(productId: string): number {
    const product = this.getProductById(productId);
    if (!product) return 0;
    return r2(Math.max(0, product.currentStock - this.getReservedStock(productId)));
  }


  // Customer reservations, advance payments and partial deliveries
  public getReservations(): Reservation[] {
    return this.state.reservations;
  }

  public getReservationById(id: string): Reservation | undefined {
    return this.state.reservations.find((reservation) => reservation.id === id);
  }

  public getReservationCancellations(reservationId?: string): ReservationCancellation[] {
    return reservationId
      ? this.state.reservationCancellations.filter((entry) => entry.reservationId === reservationId)
      : this.state.reservationCancellations;
  }

  public getReservationPayments(reservationId?: string): ReservationPayment[] {
    return reservationId
      ? this.state.reservationPayments.filter((payment) => payment.reservationId === reservationId)
      : this.state.reservationPayments;
  }

  public getReservationDeliveries(reservationId?: string): ReservationDelivery[] {
    return reservationId
      ? this.state.reservationDeliveries.filter((delivery) => delivery.reservationId === reservationId)
      : this.state.reservationDeliveries;
  }

  public createReservation(input: {
    customerId: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPriceUSD: number;
      stockPolicy: ReservationStockPolicy;
    }>;
    initialPaymentUSD?: number;
    paymentMethod?: PaymentMethod;
    expectedDeliveryDate?: string;
    notes?: string;
  }): { success: boolean; reservation?: Reservation; payment?: ReservationPayment; error?: string } {
    this.requireManager();
    if (!Array.isArray(input.items) || input.items.length === 0) {
      return { success: false, error: 'La réservation doit contenir au moins un produit.' };
    }
    const customer = this.getCustomerById(input.customerId);
    if (!customer) return { success: false, error: 'Client introuvable.' };

    const requestedBlocked = new Map<string, number>();
    for (const item of input.items) {
      if (!isNum(item.quantity) || item.quantity <= 0) {
        return { success: false, error: 'Quantité réservée invalide.' };
      }
      if (!isNum(item.unitPriceUSD) || item.unitPriceUSD < 0) {
        return { success: false, error: 'Prix unitaire invalide.' };
      }
      if (item.stockPolicy !== 'BLOCK_STOCK' && item.stockPolicy !== 'BLOCK_ON_DELIVERY') {
        return { success: false, error: 'Politique de réservation invalide.' };
      }
      const product = this.getProductById(item.productId);
      if (!product) return { success: false, error: `Produit introuvable : ${item.productId}` };
      if (item.stockPolicy === 'BLOCK_STOCK') {
        requestedBlocked.set(
          item.productId,
          r2((requestedBlocked.get(item.productId) || 0) + item.quantity)
        );
      }
    }

    for (const [productId, quantity] of requestedBlocked) {
      const product = this.getProductById(productId)!;
      const available = this.getAvailableStock(productId);
      if (available < quantity) {
        return {
          success: false,
          error: `Stock disponible insuffisant pour réserver "${product.name}". Disponible : ${available}, demandé : ${quantity}.`,
        };
      }
    }

    const exchangeRate = this.state.settings.exchangeRate;
    if (!isNum(exchangeRate) || exchangeRate <= 0) {
      return { success: false, error: 'Taux de change invalide.' };
    }
    const items: ReservationItem[] = input.items.map((item) => {
      const product = this.getProductById(item.productId)!;
      return {
        id: generateUUID(),
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantityReserved: r2(item.quantity),
        quantityDelivered: 0,
        unit: product.unit,
        unitPriceUSD: r2(item.unitPriceUSD),
        totalUSD: r2(item.quantity * item.unitPriceUSD),
        stockPolicy: item.stockPolicy,
      };
    });
    const totalUSD = r2(items.reduce((sum, item) => sum + item.totalUSD, 0));
    const rawInitialPaymentUSD = input.initialPaymentUSD === undefined ? 0 : input.initialPaymentUSD;
    if (!isNum(rawInitialPaymentUSD) || rawInitialPaymentUSD < 0 || rawInitialPaymentUSD > totalUSD) {
      return { success: false, error: 'L’avance doit être comprise entre zéro et le total de la réservation.' };
    }
    const initialPaymentUSD = r2(rawInitialPaymentUSD);
    if (initialPaymentUSD > totalUSD) {
      return { success: false, error: 'L’avance doit être comprise entre zéro et le total de la réservation.' };
    }
    if (initialPaymentUSD > 0 && !input.paymentMethod) {
      return { success: false, error: 'Le mode de paiement de l’avance est obligatoire.' };
    }

    const now = new Date().toISOString();
    const reservationNumber = generateReferenceNumber('RES');
    const reservation: Reservation = {
      id: generateUUID(),
      reservationNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      items,
      totalUSD,
      totalCDF: usdToCdf(totalUSD, exchangeRate),
      exchangeRate,
      amountPaidUSD: initialPaymentUSD,
      remainingAmountUSD: r2(totalUSD - initialPaymentUSD),
      status: initialPaymentUSD > 0 ? 'CONFIRMED' : 'PENDING',
      reservationDate: now,
      expectedDeliveryDate: input.expectedDeliveryDate,
      notes: input.notes,
      createdBy: this.state.currentUser.id,
      createdByName: this.state.currentUser.name,
      createdAt: now,
    };

    let payment: ReservationPayment | undefined;
    if (initialPaymentUSD > 0) {
      payment = {
        id: generateUUID(),
        reservationId: reservation.id,
        reservationNumber,
        amountUSD: initialPaymentUSD,
        amountCDF: usdToCdf(initialPaymentUSD, exchangeRate),
        exchangeRate,
        paymentMethod: input.paymentMethod!,
        receiptNumber: generateReferenceNumber('REC-RES'),
        paymentDate: now,
        recordedBy: this.state.currentUser.name,
      };
      this.state.reservationPayments = [payment, ...this.state.reservationPayments];
    }
    this.state.reservations = [reservation, ...this.state.reservations];
    this.persist();
    return { success: true, reservation, payment };
  }

  public recordReservationPayment(
    reservationId: string,
    amountUSD: number,
    paymentMethod: PaymentMethod,
    notes?: string
  ): { success: boolean; payment?: ReservationPayment; error?: string } {
    this.requireManager();
    const reservation = this.getReservationById(reservationId);
    if (!reservation) return { success: false, error: 'Réservation introuvable.' };
    if (reservation.status === 'CANCELLED' || reservation.status === 'CANCELLATION_PENDING') {
      return { success: false, error: 'Cette réservation ne peut plus recevoir de paiement.' };
    }
    if (!isNum(amountUSD) || amountUSD <= 0) {
      return { success: false, error: 'Le montant du versement doit être supérieur à zéro.' };
    }
    if (amountUSD > reservation.remainingAmountUSD + 0.001) {
      return { success: false, error: 'Le versement dépasse le solde de la réservation.' };
    }
    const exchangeRate = this.state.settings.exchangeRate;
    const now = new Date().toISOString();
    const payment: ReservationPayment = {
      id: generateUUID(),
      reservationId,
      reservationNumber: reservation.reservationNumber,
      amountUSD: r2(amountUSD),
      amountCDF: usdToCdf(r2(amountUSD), exchangeRate),
      exchangeRate,
      paymentMethod,
      receiptNumber: generateReferenceNumber('REC-RES'),
      paymentDate: now,
      recordedBy: this.state.currentUser.name,
      notes,
    };
    reservation.amountPaidUSD = r2(reservation.amountPaidUSD + amountUSD);
    reservation.remainingAmountUSD = r2(Math.max(0, reservation.totalUSD - reservation.amountPaidUSD));
    if (reservation.status === 'PENDING') reservation.status = 'CONFIRMED';
    this.state.reservationPayments = [payment, ...this.state.reservationPayments];
    this.persist();
    return { success: true, payment };
  }

  public deliverReservation(input: {
    reservationId: string;
    items: Array<{ reservationItemId: string; quantity: number }>;
    notes?: string;
  }): { success: boolean; delivery?: ReservationDelivery; error?: string } {
    this.requireManager();
    const reservation = this.getReservationById(input.reservationId);
    if (!reservation) return { success: false, error: 'Réservation introuvable.' };
    if (reservation.status === 'CANCELLED' || reservation.status === 'CANCELLATION_PENDING' || reservation.status === 'DELIVERED') {
      return { success: false, error: 'Cette réservation ne peut pas être livrée dans son état actuel.' };
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      return { success: false, error: 'Aucun produit sélectionné pour la livraison.' };
    }

    const requested = new Map<string, number>();
    for (const line of input.items) {
      if (!isNum(line.quantity) || line.quantity <= 0) {
        return { success: false, error: 'Quantité livrée invalide.' };
      }
      const reservationItem = reservation.items.find((item) => item.id === line.reservationItemId);
      if (!reservationItem) return { success: false, error: 'Ligne de réservation introuvable.' };
      const outstanding = r2(reservationItem.quantityReserved - reservationItem.quantityDelivered);
      const combined = r2((requested.get(line.reservationItemId) || 0) + line.quantity);
      if (combined > outstanding) {
        return { success: false, error: `La quantité dépasse le reste à livrer pour ${reservationItem.productName}.` };
      }
      requested.set(line.reservationItemId, combined);
    }

    const physicalByProduct = new Map<string, number>();
    const unblockedByProduct = new Map<string, number>();
    for (const [itemId, quantity] of requested) {
      const item = reservation.items.find((entry) => entry.id === itemId)!;
      physicalByProduct.set(item.productId, r2((physicalByProduct.get(item.productId) || 0) + quantity));
      if (item.stockPolicy === 'BLOCK_ON_DELIVERY') {
        unblockedByProduct.set(item.productId, r2((unblockedByProduct.get(item.productId) || 0) + quantity));
      }
    }
    for (const [productId, quantity] of physicalByProduct) {
      const product = this.getProductById(productId);
      if (!product) return { success: false, error: `Produit introuvable : ${productId}` };
      if (product.currentStock < quantity) {
        return { success: false, error: `Stock physique insuffisant pour livrer ${product.name}.` };
      }
    }
    for (const [productId, quantity] of unblockedByProduct) {
      const product = this.getProductById(productId)!;
      if (this.getAvailableStock(productId) < quantity) {
        return { success: false, error: `Stock disponible insuffisant pour livrer ${product.name}.` };
      }
    }

    const deliveryNumber = generateReferenceNumber('LIV-RES');
    const now = new Date().toISOString();
    const deliveryItems = input.items.map((line) => {
      const item = reservation.items.find((entry) => entry.id === line.reservationItemId)!;
      return {
        reservationItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        quantityDelivered: r2(line.quantity),
        unit: item.unit,
      };
    });

    // Decrement physical stock once. For BLOCK_STOCK, the reserved amount is
    // released by the same quantity, so available stock does not decrease twice.
    for (const [itemId, quantity] of requested) {
      const item = reservation.items.find((entry) => entry.id === itemId)!;
      const product = this.getProductById(item.productId)!;
      const previousStock = product.currentStock;
      const newStock = r2(previousStock - quantity);
      product.currentStock = newStock;
      product.updatedAt = now;
      item.quantityDelivered = r2(item.quantityDelivered + quantity);
      this.addStockMovement({
        productId: product.id,
        productName: product.name,
        quantity: -quantity,
        type: 'OUT',
        reason: `Livraison réservation ${reservation.reservationNumber}`,
        referenceNumber: deliveryNumber,
        previousStock,
        newStock,
      });
    }

    const allDelivered = reservation.items.every(
      (item) => item.quantityDelivered >= item.quantityReserved
    );
    reservation.status = allDelivered ? 'DELIVERED' : 'PARTIALLY_DELIVERED';
    const delivery: ReservationDelivery = {
      id: generateUUID(),
      deliveryNumber,
      reservationId: reservation.id,
      reservationNumber: reservation.reservationNumber,
      customerId: reservation.customerId,
      customerName: reservation.customerName,
      items: deliveryItems,
      deliveryDate: now,
      deliveredBy: this.state.currentUser.id,
      deliveredByName: this.state.currentUser.name,
      notes: input.notes,
    };
    this.state.reservationDeliveries = [delivery, ...this.state.reservationDeliveries];
    this.persist();
    return { success: true, delivery };
  }

  public requestReservationCancellation(
    reservationId: string,
    reason: string
  ): { success: boolean; cancellation?: ReservationCancellation; error?: string } {
    this.requireManager();
    const reservation = this.getReservationById(reservationId);
    if (!reservation) return { success: false, error: 'Réservation introuvable.' };
    if (reservation.status === 'CANCELLED' || reservation.status === 'CANCELLATION_PENDING' || reservation.status === 'DELIVERED') {
      return { success: false, error: 'Cette réservation ne peut pas être annulée dans son état actuel.' };
    }
    if (reservation.items.some((item) => item.quantityDelivered > 0)) {
      return { success: false, error: 'Annulation automatique impossible après une livraison partielle. Traitez d’abord le solde restant.' };
    }
    if (!reason.trim()) return { success: false, error: 'Le motif de la demande est obligatoire.' };
    const cancellation: ReservationCancellation = {
      id: generateUUID(),
      reservationId: reservation.id,
      reservationNumber: reservation.reservationNumber,
      reason: reason.trim(),
      requestedBy: this.state.currentUser.id,
      requestedByName: this.state.currentUser.name,
      requestedAt: new Date().toISOString(),
      status: 'PENDING',
      amountPaidUSD: reservation.amountPaidUSD,
    };
    reservation.status = 'CANCELLATION_PENDING';
    this.state.reservationCancellations = [cancellation, ...this.state.reservationCancellations];
    this.persist();
    return { success: true, cancellation };
  }

  public decideReservationCancellation(input: {
    cancellationId: string;
    decision: 'REFUND_FULL' | 'REFUND_PARTIAL' | 'RETAIN_FULL' | 'RETAIN_PARTIAL';
    amountRefundedUSD: number;
    amountRetainedUSD: number;
    decisionReason: string;
  }): { success: boolean; cancellation?: ReservationCancellation; error?: string } {
    this.requireAdmin();
    const cancellation = this.state.reservationCancellations.find((entry) => entry.id === input.cancellationId);
    if (!cancellation) return { success: false, error: 'Demande d’annulation introuvable.' };
    if (cancellation.status !== 'PENDING') return { success: false, error: 'Cette demande a déjà été traitée.' };
    const refunded = r2(input.amountRefundedUSD);
    const retained = r2(input.amountRetainedUSD);
    if (!isNum(refunded) || !isNum(retained) || refunded < 0 || retained < 0) {
      return { success: false, error: 'Montants de remboursement ou de retenue invalides.' };
    }
    if (r2(refunded + retained) !== r2(cancellation.amountPaidUSD)) {
      return { success: false, error: 'Le remboursement et la retenue doivent correspondre exactement aux avances reçues.' };
    }
    if (!input.decisionReason.trim()) return { success: false, error: 'Le motif de la décision est obligatoire.' };
    const fullRefund = refunded === cancellation.amountPaidUSD && retained === 0;
    const fullRetention = retained === cancellation.amountPaidUSD && refunded === 0;
    if (input.decision === 'REFUND_FULL' && !fullRefund) return { success: false, error: 'Pour un remboursement total, remboursez toute l’avance.' };
    if (input.decision === 'RETAIN_FULL' && !fullRetention) return { success: false, error: 'Pour une retenue totale, retenez toute l’avance.' };
    if (input.decision === 'REFUND_PARTIAL' && (refunded <= 0 || retained <= 0)) return { success: false, error: 'Un remboursement partiel exige un remboursement et une retenue positifs.' };
    if (input.decision === 'RETAIN_PARTIAL' && (refunded <= 0 || retained <= 0)) return { success: false, error: 'Une retenue partielle exige un remboursement et une retenue positifs.' };

    cancellation.status = 'DECIDED';
    cancellation.decision = input.decision;
    cancellation.amountRefundedUSD = refunded;
    cancellation.amountRetainedUSD = retained;
    cancellation.decisionReason = input.decisionReason.trim();
    cancellation.decidedBy = this.state.currentUser.id;
    cancellation.decidedByName = this.state.currentUser.name;
    cancellation.decidedAt = new Date().toISOString();
    const reservation = this.getReservationById(cancellation.reservationId);
    if (!reservation) return { success: false, error: 'Réservation liée introuvable.' };
    reservation.status = 'CANCELLED';
    this.persist();
    return { success: true, cancellation };
  }

  public getStockDamages(): StockDamage[] {
    return this.state.stockDamages;
  }

  public recordStockDamage(input: {
    productId: string;
    quantity: number;
    status: StockDamageStatus;
    estimatedLossUSD: number;
    description: string;
    supplierId?: string;
    notes?: string;
  }): { success: boolean; damage?: StockDamage; error?: string } {
    this.requireManager();
    const product = this.getProductById(input.productId);
    if (!product) return { success: false, error: 'Produit introuvable.' };
    if (!isNum(input.quantity) || input.quantity <= 0) return { success: false, error: 'Quantité endommagée invalide.' };
    if (!isNum(input.estimatedLossUSD) || input.estimatedLossUSD < 0) return { success: false, error: 'Valeur de perte invalide.' };
    if (!input.description.trim()) return { success: false, error: 'La description est obligatoire.' };
    const removesStock = input.status === 'UNSELLABLE' || input.status === 'RETURN_TO_SUPPLIER' || input.status === 'WRITTEN_OFF';
    if (removesStock && this.getAvailableStock(product.id) < input.quantity) {
      return { success: false, error: 'La quantité dépasse le stock disponible non réservé.' };
    }
    const supplier = input.supplierId ? this.getSupplierById(input.supplierId) : undefined;
    if (input.status === 'RETURN_TO_SUPPLIER' && !supplier) {
      return { success: false, error: 'Sélectionnez le fournisseur pour le retour.' };
    }
    const now = new Date().toISOString();
    const damageNumber = generateReferenceNumber('DOM');
    const damage: StockDamage = {
      id: generateUUID(),
      damageNumber,
      productId: product.id,
      productName: product.name,
      quantity: r2(input.quantity),
      unit: product.unit,
      status: input.status,
      estimatedLossUSD: r2(input.estimatedLossUSD),
      description: input.description.trim(),
      supplierId: supplier?.id,
      supplierName: supplier?.companyName,
      date: now,
      recordedBy: this.state.currentUser.id,
      recordedByName: this.state.currentUser.name,
      notes: input.notes,
    };
    if (removesStock) {
      const previousStock = product.currentStock;
      const newStock = r2(previousStock - input.quantity);
      product.currentStock = newStock;
      product.updatedAt = now;
      this.addStockMovement({
        productId: product.id,
        productName: product.name,
        quantity: -input.quantity,
        type: input.status === 'RETURN_TO_SUPPLIER' ? 'RETURN_SUPPLIER' : 'LOSS_DAMAGE',
        reason: `Déclaration de dommage ${damageNumber} : ${input.description}`,
        referenceNumber: damageNumber,
        previousStock,
        newStock,
      });
    }
    this.state.stockDamages = [damage, ...this.state.stockDamages];
    this.persist();
    return { success: true, damage };
  }

  public getFreeIssues(): FreeIssue[] {
    return this.state.freeIssues;
  }

  public recordFreeIssue(input: {
    productId: string;
    quantity: number;
    beneficiary: string;
    reason: string;
    notes?: string;
  }): { success: boolean; issue?: FreeIssue; error?: string } {
    this.requireManager();
    const product = this.getProductById(input.productId);
    if (!product) return { success: false, error: 'Produit introuvable.' };
    if (!isNum(input.quantity) || input.quantity <= 0) return { success: false, error: 'Quantité invalide.' };
    if (!input.beneficiary.trim() || !input.reason.trim()) {
      return { success: false, error: 'Le bénéficiaire et le motif sont obligatoires.' };
    }
    const available = this.getAvailableStock(product.id);
    if (available < input.quantity) {
      return { success: false, error: `Stock disponible insuffisant. Disponible : ${available} ${product.unit}.` };
    }
    const now = new Date().toISOString();
    const issueNumber = generateReferenceNumber('GRAT');
    const issue: FreeIssue = {
      id: generateUUID(),
      issueNumber,
      productId: product.id,
      productName: product.name,
      quantity: r2(input.quantity),
      unit: product.unit,
      estimatedValueUSD: r2(input.quantity * product.sellPriceUSD),
      beneficiary: input.beneficiary.trim(),
      reason: input.reason.trim(),
      date: now,
      issuedBy: this.state.currentUser.id,
      issuedByName: this.state.currentUser.name,
      notes: input.notes,
    };
    const previousStock = product.currentStock;
    const newStock = r2(previousStock - input.quantity);
    product.currentStock = newStock;
    product.updatedAt = now;
    this.addStockMovement({
      productId: product.id,
      productName: product.name,
      quantity: -input.quantity,
      type: 'OUT',
      reason: `Sortie gratuite ${issueNumber} au bénéfice de ${input.beneficiary}`,
      referenceNumber: issueNumber,
      previousStock,
      newStock,
    });
    this.state.freeIssues = [issue, ...this.state.freeIssues];
    this.persist();
    return { success: true, issue };
  }

  public getProductById(id: string): Product | undefined {
    return this.state.products.find((p) => p.id === id);
  }

  public getProductByBarcode(barcode: string): Product | undefined {
    return this.state.products.find((p) => p.barcode === barcode || p.sku.toLowerCase() === barcode.toLowerCase());
  }

  public saveProduct(productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Product {
    this.requireManager();
    this.requireCorePermission('stock.manage');
    const name = (productData.name || '').trim();
    if (!name) throw new Error('Le nom du produit est obligatoire.');
    for (const [label, v] of [
      ['Prix d’achat', productData.buyPriceUSD],
      ['Prix de vente', productData.sellPriceUSD],
      ['Stock', productData.currentStock],
      ['Stock minimum', productData.minStock],
    ] as Array<[string, number]>) {
      if (!isNum(v) || v < 0) throw new Error(`${label} invalide (nombre positif attendu).`);
    }
    const dup = this.state.products.find(
      (p) =>
        p.id !== productData.id &&
        ((productData.sku && p.sku.toLowerCase() === productData.sku.trim().toLowerCase()) ||
          (productData.barcode && p.barcode === productData.barcode.trim()))
    );
    if (dup) throw new Error(`SKU ou code-barres déjà utilisé par « ${dup.name} ».`);
    productData = { ...productData, name, sku: (productData.sku || '').trim(), barcode: (productData.barcode || '').trim() };

    const now = new Date().toISOString();
    const category = this.state.categories.find((c) => c.id === productData.categoryId);
    const categoryName = category ? category.name : 'Divers';

    if (productData.id) {
      const existing = this.getProductById(productData.id);
      if (!existing) throw new Error('Produit introuvable (déjà supprimé ?).');
      const reservedStock = this.getReservedStock(existing.id);
      if (productData.currentStock < reservedStock) {
        throw new Error(
          `Stock impossible à réduire sous ${reservedStock} ${existing.unit} : cette quantité est réservée aux clients.`
        );
      }
      const updated: Product = {
        ...existing,
        ...productData,
        id: productData.id,
        categoryName,
        updatedAt: now,
      };

      // Check if stock changed directly to record movement
      if (existing && existing.currentStock !== updated.currentStock) {
        const diff = updated.currentStock - existing.currentStock;
        this.addStockMovement({
          productId: updated.id,
          productName: updated.name,
          quantity: diff,
          type: 'ADJUSTMENT',
          reason: 'Ajustement manuel direct de fiche produit',
          referenceNumber: `AJU-${new Date().getTime().toString().slice(-6)}`,
          previousStock: existing.currentStock,
          newStock: updated.currentStock,
        });
      }

      this.state.products = this.state.products.map((p) => (p.id === updated.id ? updated : p));
      if (existing.currentStock !== updated.currentStock) {
        this.enqueue('STOCK_ADJUSTMENT', { id: generateUUID(), productId: updated.id, quantity_delta: r2(updated.currentStock - existing.currentStock), expected_quantity: existing.currentStock, reason: 'Ajustement manuel de fiche produit' });
      }
      this.enqueue('PRODUCT_UPDATE', updated);
      this.afterWrite();
      return updated;
    } else {
      const newProduct: Product = {
        ...productData,
        id: `prod-${generateUUID().substring(0, 8)}`,
        categoryName,
        createdAt: now,
        updatedAt: now,
      };

      // Record initial stock movement if > 0
      if (newProduct.currentStock > 0) {
        this.addStockMovement({
          productId: newProduct.id,
          productName: newProduct.name,
          quantity: newProduct.currentStock,
          type: 'IN',
          reason: 'Création produit avec stock initial',
          referenceNumber: `INIT-${newProduct.sku}`,
          previousStock: 0,
          newStock: newProduct.currentStock,
        });
      }

      this.state.products = [newProduct, ...this.state.products];
      this.enqueue('PRODUCT_CREATE', newProduct);
      this.afterWrite();
      return newProduct;
    }
  }

  public deleteProduct(id: string) {
    this.requireManager();
    this.requireCorePermission('stock.manage');
    const product = this.getProductById(id);
    if (!product) throw new Error('Produit introuvable.');
    if (this.coreContext) {
      if (product.currentStock !== 0 || this.getReservedStock(id) > 0) throw new Error('Le stock et les réservations doivent être soldés avant d’archiver le produit.');
      this.enqueue('PRODUCT_ARCHIVE', product);
    }
    this.state.products = this.state.products.filter((p) => p.id !== id);
    this.afterWrite();
  }

  // Stock Movement Operations
  public getStockMovements(productId?: string): StockMovement[] {
    if (productId) {
      return this.state.stockMovements.filter((m) => m.productId === productId);
    }
    return this.state.stockMovements;
  }

  public addStockMovement(
    movementData: Omit<StockMovement, 'id' | 'date' | 'userId' | 'userName'> & {
      userId?: string;
      userName?: string;
    }
  ): StockMovement {
    const movement: StockMovement = {
      ...movementData,
      id: generateUUID(),
      date: new Date().toISOString(),
      userId: movementData.userId || this.state.currentUser.id,
      userName: movementData.userName || this.state.currentUser.name,
    };
    this.state.stockMovements = [movement, ...this.state.stockMovements];
    return movement;
  }

  /**
   * Manual stock movement (entry, exit, loss...). Updates the product stock AND records the
   * movement atomically, then persists (the old UI mutated the product directly and never saved).
   */
  public recordManualMovement(
    data: Omit<StockMovement, 'id' | 'date' | 'userId' | 'userName' | 'previousStock' | 'newStock'>
  ): StockMovement {
    this.requireManager();
    this.requireCorePermission('stock.manage');
    const product = this.getProductById(data.productId);
    if (!product) throw new Error('Produit introuvable.');
    if (!isNum(data.quantity) || data.quantity === 0) throw new Error('Quantité invalide.');
    if (data.quantity < 0 && this.getAvailableStock(product.id) < Math.abs(data.quantity)) {
      throw new Error(
        `Stock disponible insuffisant pour ce mouvement. Disponible : ${this.getAvailableStock(product.id)} ${product.unit}.`
      );
    }
    const previousStock = product.currentStock;
    const newStock = r2(previousStock + data.quantity);
    product.currentStock = newStock;
    product.updatedAt = new Date().toISOString();
    const movement = this.addStockMovement({ ...data, previousStock, newStock });
    this.enqueue('STOCK_ADJUSTMENT', { id: movement.id, productId: product.id, quantity_delta: data.quantity, expected_quantity: previousStock, reason: data.reason });
    this.afterWrite();
    return movement;
  }

  // Customer Operations
  public getCustomers(): Customer[] {
    return this.state.customers;
  }

  public getCustomerById(id: string): Customer | undefined {
    return this.state.customers.find((c) => c.id === id);
  }

  public saveCustomer(customerData: Omit<Customer, 'id' | 'registeredAt'> & { id?: string }): Customer {
    this.requireLoggedIn();
    this.requireCorePermission('customers.manage');
    if (!(customerData.name || '').trim()) throw new Error('Le nom du client est obligatoire.');
    if (customerData.creditLimitUSD !== undefined && (!isNum(customerData.creditLimitUSD) || customerData.creditLimitUSD < 0)) throw new Error('Limite de crédit invalide.');
    if (customerData.id) {
      const existing = this.getCustomerById(customerData.id);
      if (!existing) throw new Error('Client introuvable.');
      const updated: Customer = {
        ...existing,
        ...customerData,
        id: customerData.id,
      };
      this.state.customers = this.state.customers.map((c) => (c.id === updated.id ? updated : c));
      this.enqueue('CUSTOMER_UPDATE', updated);
      this.afterWrite();
      return updated;
    } else {
      const newCustomer: Customer = {
        ...customerData,
        id: `cust-${generateUUID().substring(0, 8)}`,
        registeredAt: new Date().toISOString(),
      };
      this.state.customers = [newCustomer, ...this.state.customers];
      this.enqueue('CUSTOMER_CREATE', newCustomer);
      this.afterWrite();
      return newCustomer;
    }
  }

  // Supplier Operations
  public getSuppliers(): Supplier[] {
    return this.state.suppliers;
  }

  public getSupplierById(id: string): Supplier | undefined {
    return this.state.suppliers.find((s) => s.id === id);
  }

  public saveSupplier(supplierData: Omit<Supplier, 'id' | 'registeredAt'> & { id?: string }): Supplier {
    this.requireManager();
    this.requireCorePermission('suppliers.manage');
    if (supplierData.id) {
      const existing = this.getSupplierById(supplierData.id);
      if (!existing) throw new Error('Fournisseur introuvable.');
      const updated: Supplier = {
        ...existing,
        ...supplierData,
        id: supplierData.id,
      };
      this.state.suppliers = this.state.suppliers.map((s) => (s.id === updated.id ? updated : s));
      this.enqueue('SUPPLIER_UPDATE', updated);
      this.afterWrite();
      return updated;
    } else {
      const newSupplier: Supplier = {
        ...supplierData,
        id: `supp-${generateUUID().substring(0, 8)}`,
        registeredAt: new Date().toISOString(),
      };
      this.state.suppliers = [newSupplier, ...this.state.suppliers];
      this.enqueue('SUPPLIER_CREATE', newSupplier);
      this.afterWrite();
      return newSupplier;
    }
  }

  // Import-Export: independent local collections and dedicated Fondation Kenda Core record API.
  public getImportExportData() {
    return {
      suppliers: this.state.importSuppliers || [], shipments: this.state.importShipments || [],
      expenses: this.state.importExpenses || [], events: this.state.importTrackingEvents || [],
      payments: this.state.importPayments || [], documents: this.state.importDocuments || [],
    };
  }

  public saveImportExportRecord(type: 'supplier'|'shipment'|'expense'|'tracking'|'payment'|'document', input: Record<string, unknown>) {
    this.requireManager();
    const now = new Date().toISOString();
    const id = typeof input.id === 'string' && input.id ? input.id : generateUUID();
    const data: Record<string, unknown> = { ...input, id, updatedAt: now };
    if (!data.createdAt) data.createdAt = now;
    const collections = {
      supplier: 'importSuppliers', shipment: 'importShipments', expense: 'importExpenses',
      tracking: 'importTrackingEvents', payment: 'importPayments', document: 'importDocuments',
    } as const;
    const key = collections[type];
    const rows = this.state[key] as Array<{id:string}>;
    const index = rows.findIndex(row => row.id === id);
    if (index >= 0) rows[index] = data as {id:string};
    else rows.unshift(data as {id:string});
    if (this.coreContext) this.enqueue('IMPORT_EXPORT_RECORD_UPSERT', { id, type, data });
    this.afterWrite();
    return data;
  }

  public deleteImportExportRecord(type: 'supplier'|'shipment'|'expense'|'tracking'|'payment'|'document', id: string) {
    this.requireManager();
    const data = this.getImportExportData();
    const collections = { supplier: data.suppliers, shipment: data.shipments, expense: data.expenses, tracking: data.events, payment: data.payments, document: data.documents };
    const current = collections[type].find(row => row.id === id) as unknown as Record<string,unknown> | undefined;
    if (!current) return;
    const tombstone = { ...current, id, _deletedAt: new Date().toISOString() };
    const keys = { supplier:'importSuppliers', shipment:'importShipments', expense:'importExpenses', tracking:'importTrackingEvents', payment:'importPayments', document:'importDocuments' } as const;
    const key = keys[type];
    (this.state[key] as Array<{id:string}>).splice(0, (this.state[key] as Array<{id:string}>).length, ...(this.state[key] as Array<{id:string}>).filter(row => row.id !== id));
    if (this.coreContext) this.enqueue('IMPORT_EXPORT_RECORD_UPSERT', { id, type, data: tombstone });
    this.afterWrite();
  }

  public deleteImportExportShipment(id: string) {
    this.requireManager();
    for (const [type, rows] of [
      ['expense', this.state.importExpenses], ['tracking', this.state.importTrackingEvents], ['payment', this.state.importPayments],
    ] as const) {
      for (const row of rows.filter(item => item.shipmentId === id)) this.deleteImportExportRecord(type, row.id);
    }
    this.deleteImportExportRecord('shipment', id);
  }

  // Cargo management: durable local storage with queued synchronization to Fondation Kenda Core.
  public getCargoPackages(): CargoPackage[] {
    return this.state.cargoPackages || [];
  }

  public saveCargoPackage(input: Partial<CargoPackage>): CargoPackage {
    this.requireManager();
    const now = new Date().toISOString();
    const existing = input.id ? this.getCargoPackages().find((item) => item.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Colis introuvable.');
    const customerName = String(input.customerName || existing?.customerName || '').trim();
    const description = String(input.description || existing?.description || '').trim();
    if (!customerName) throw new Error('Le nom du client est obligatoire.');
    if (!description) throw new Error('La description du colis est obligatoire.');
    const packingNumber = String(input.packingNumber ?? existing?.packingNumber ?? '').trim();
    if (!packingNumber) throw new Error('Le numéro PKG fourni par le fournisseur est obligatoire.');
    if (packingNumber.length > 120) throw new Error('Le numéro PKG ne peut pas dépasser 120 caractères.');
    const duplicatePackingNumber = this.getCargoPackages().some((item) =>
      item.id !== existing?.id && item.packingNumber.trim().toLowerCase() === packingNumber.toLowerCase()
    );
    if (duplicatePackingNumber) throw new Error('Ce numéro PKG est déjà associé à un autre colis.');
    const piecesCount = Number(input.piecesCount ?? existing?.piecesCount ?? 1);
    const weightKg = Number(input.weightKg ?? existing?.weightKg ?? 0);
    const volumeCbm = Number(input.volumeCbm ?? existing?.volumeCbm ?? 0);
    if (!Number.isFinite(piecesCount) || piecesCount < 1 || !Number.isFinite(weightKg) || weightKg < 0 || !Number.isFinite(volumeCbm) || volumeCbm < 0) {
      throw new Error('Quantité, poids ou volume invalide.');
    }
    const transportMode = input.transportMode ?? existing?.transportMode ?? 'SEA';
    const suppliedUnitPrice = input.unitPriceUSD;
    const unitPriceUSD = suppliedUnitPrice !== undefined
      ? Number(suppliedUnitPrice)
      : existing?.unitPriceUSD;
    const legacyInitialCostUSD = Number(input.initialCostUSD ?? existing?.initialCostUSD ?? 0);
    const legacyTransportFeeUSD = Number(input.transportFeeUSD ?? existing?.transportFeeUSD ?? 0);
    const legacyCustomsFeeUSD = Number(input.customsFeeUSD ?? existing?.customsFeeUSD ?? 0);
    const legacyExtraFeeUSD = Number(input.extraFeeUSD ?? existing?.extraFeeUSD ?? 0);
    const legacyAmounts = [legacyInitialCostUSD, legacyTransportFeeUSD, legacyCustomsFeeUSD, legacyExtraFeeUSD];
    if (legacyAmounts.some((amount) => !Number.isFinite(amount) || amount < 0)) throw new Error('Un montant Cargo historique est invalide.');
    let totalAmountUSD: number;
    if (unitPriceUSD !== undefined) {
      if (!Number.isFinite(unitPriceUSD) || unitPriceUSD <= 0) throw new Error('Le prix unitaire doit être supérieur à zéro.');
      const billableQuantity = transportMode === 'AIR' ? weightKg : volumeCbm;
      if (!Number.isFinite(billableQuantity) || billableQuantity <= 0) {
        throw new Error(transportMode === 'AIR' ? 'Le poids en kilogrammes doit être supérieur à zéro.' : 'Le volume en CBM doit être supérieur à zéro.');
      }
      totalAmountUSD = r2(billableQuantity * unitPriceUSD);
    } else if (existing) {
      // Compatibilité : un ancien colis sans prix unitaire conserve sa facture historique.
      totalAmountUSD = r2(legacyAmounts.reduce((sum, amount) => sum + amount, 0));
    } else {
      throw new Error('Le prix unitaire de facturation est obligatoire.');
    }
    const initialCostUSD = unitPriceUSD !== undefined ? 0 : legacyInitialCostUSD;
    const transportFeeUSD = unitPriceUSD !== undefined ? 0 : legacyTransportFeeUSD;
    const customsFeeUSD = unitPriceUSD !== undefined ? 0 : legacyCustomsFeeUSD;
    const extraFeeUSD = unitPriceUSD !== undefined ? 0 : legacyExtraFeeUSD;
    const amountPaidUSD = existing?.amountPaidUSD ?? Number(input.amountPaidUSD ?? 0);
    const pkg: CargoPackage = {
      id: existing?.id || input.id || generateUUID(),
      packingNumber,
      customerId: input.customerId ?? existing?.customerId,
      customerName,
      customerPhone: String(input.customerPhone ?? existing?.customerPhone ?? ''),
      supplierName: String(input.supplierName ?? existing?.supplierName ?? ''),
      description,
      originCountry: String(input.originCountry ?? existing?.originCountry ?? 'Chine'),
      originCity: String(input.originCity ?? existing?.originCity ?? ''),
      destinationCountry: String(input.destinationCountry ?? existing?.destinationCountry ?? 'RDC'),
      destinationCity: String(input.destinationCity ?? existing?.destinationCity ?? 'Bunia'),
      transportMode,
      carrierName: String(input.carrierName ?? existing?.carrierName ?? ''),
      registrationDate: existing?.registrationDate || input.registrationDate || now,
      expectedShippingDate: input.expectedShippingDate ?? existing?.expectedShippingDate,
      piecesCount,
      weightKg,
      volumeCbm,
      unitPriceUSD,
      photos: input.photos ?? existing?.photos ?? [],
      documents: input.documents ?? existing?.documents ?? [],
      currentStatus: existing?.currentStatus || input.currentStatus || 'REGISTERED',
      initialCostUSD,
      transportFeeUSD,
      customsFeeUSD,
      extraFeeUSD,
      totalAmountUSD,
      amountPaidUSD,
      remainingBalanceUSD: r2(Math.max(0, totalAmountUSD - amountPaidUSD)),
      currency: input.currency ?? existing?.currency ?? 'USD',
      exchangeRate: Number(input.exchangeRate ?? existing?.exchangeRate ?? this.state.settings.exchangeRate),
      events: existing?.events ?? input.events ?? [],
      payments: existing?.payments ?? input.payments ?? [],
      createdById: existing?.createdById || this.state.currentUser.id,
      createdByName: existing?.createdByName || this.state.currentUser.name,
      syncStatus: this.coreContext ? 'PENDING' : (existing?.syncStatus || this.syncStatusForNewRecord()),
    };
    this.state.cargoPackages = existing
      ? this.getCargoPackages().map((item) => item.id === pkg.id ? pkg : item)
      : [pkg, ...this.getCargoPackages()];
    if (this.coreContext) this.enqueue('CARGO_PACKAGE_UPSERT', pkg);
    this.afterWrite();
    return pkg;
  }

  public addCargoEvent(packageId: string, input: Partial<CargoEvent>): CargoPackage {
    this.requireManager();
    const pkg = this.getCargoPackages().find((item) => item.id === packageId);
    if (!pkg) throw new Error('Colis introuvable.');
    if (!input.status) throw new Error('Sélectionnez le nouveau statut du colis.');
    const event: CargoEvent = {
      id: generateUUID(),
      packageId,
      status: input.status,
      country: String(input.country || pkg.destinationCountry),
      city: String(input.city || pkg.destinationCity),
      location: input.location,
      date: input.date || new Date().toISOString(),
      comment: String(input.comment || ''),
      photoUrl: input.photoUrl,
      documentUrl: input.documentUrl,
      recordedBy: this.state.currentUser.id,
      recordedByName: this.state.currentUser.name,
    };
    const updated = { ...pkg, currentStatus: event.status, events: [...(pkg.events || []), event] };
    updated.syncStatus = this.coreContext ? 'PENDING' : updated.syncStatus;
    this.state.cargoPackages = this.getCargoPackages().map((item) => item.id === packageId ? updated : item);
    if (this.coreContext) this.enqueue('CARGO_PACKAGE_UPSERT', updated);
    this.afterWrite();
    return updated;
  }

  public addCargoPayment(packageId: string, input: Partial<CargoPayment>): CargoPackage {
    this.requireManager();
    const pkg = this.getCargoPackages().find((item) => item.id === packageId);
    if (!pkg) throw new Error('Colis introuvable.');
    const amountUSD = Number(input.amountUSD || 0);
    const exchangeRate = Number(input.exchangeRate || this.state.settings.exchangeRate);
    if (!Number.isFinite(amountUSD) || amountUSD <= 0) throw new Error('Le montant du paiement doit être supérieur à zéro.');
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error('Taux de change invalide.');
    if (amountUSD > pkg.remainingBalanceUSD + 0.005) throw new Error('Le paiement dépasse le solde restant.');
    const payment: CargoPayment = {
      id: generateUUID(),
      packageId,
      amountUSD: r2(amountUSD),
      amountCDF: r2(Number(input.amountCDF || amountUSD * exchangeRate)),
      exchangeRate,
      paymentMethod: input.paymentMethod || 'CASH',
      receiptNumber: input.receiptNumber || generateReferenceNumber('REC-CARGO'),
      date: input.date || new Date().toISOString(),
      recordedBy: this.state.currentUser.id,
      notes: input.notes,
    };
    const amountPaidUSD = r2(pkg.amountPaidUSD + payment.amountUSD);
    const updated = { ...pkg, amountPaidUSD, remainingBalanceUSD: r2(Math.max(0, pkg.totalAmountUSD - amountPaidUSD)), payments: [...(pkg.payments || []), payment] };
    updated.syncStatus = this.coreContext ? 'PENDING' : updated.syncStatus;
    this.state.cargoPackages = this.getCargoPackages().map((item) => item.id === packageId ? updated : item);
    if (this.coreContext) this.enqueue('CARGO_PACKAGE_UPSERT', updated);
    this.afterWrite();
    return updated;
  }

  // Sales & POS Engine
  public getSales(): Sale[] {
    return this.state.sales;
  }

  /**
   * Atomic Transaction for Sale Creation:
   * 1. Checks stock availability (prevents negative unless approved)
   * 2. Decrements product stocks
   * 3. Creates stock movement records
   * 4. Updates customer debt if partial / credit
   * 5. Saves sale record with immutable exchange rate
   * 6. Queues for Firestore sync if offline
   */
  public executeSale(saleInput: {
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
    amountPaidUSD: number;
    currency?: 'USD' | 'CDF';
    notes?: string;
    allowNegativeStock?: boolean;
  }): { success: boolean; sale?: Sale; error?: string } {
    if (this.isBootstrapping) return { success: false, error: 'Chargement des données en cours. Réessayez après sa fin.' };
    if (!this.sessionUserId) return { success: false, error: 'Session expirée. Reconnectez-vous.' };

    // 1. Validation & Stock checks
    if (!Array.isArray(saleInput.items) || saleInput.items.length === 0) {
      return { success: false, error: 'Le panier est vide.' };
    }
    const requested = new Map<string, number>();
    for (const item of saleInput.items) {
      if (!isNum(item.quantity) || item.quantity <= 0) {
        return { success: false, error: 'Quantité invalide dans le panier.' };
      }
      if (!isNum(item.unitPriceUSD) || item.unitPriceUSD < 0) {
        return { success: false, error: 'Prix unitaire invalide dans le panier.' };
      }
      requested.set(item.productId, (requested.get(item.productId) || 0) + item.quantity);
    }
    for (const [productId, qty] of requested) {
      const prod = this.getProductById(productId);
      if (!prod) {
        return { success: false, error: `Produit introuvable: ${productId}` };
      }
      const availableStock = this.getAvailableStock(productId);
      const reservedStock = this.getReservedStock(productId);
      if (
        availableStock < qty &&
        (!saleInput.allowNegativeStock || reservedStock > 0)
      ) {
        return {
          success: false,
          error: `Stock disponible insuffisant pour "${prod.name}" (Physique: ${prod.currentStock} ${prod.unit}, réservé: ${this.getReservedStock(productId)} ${prod.unit}, disponible: ${availableStock} ${prod.unit}, demandé: ${qty}).`,
        };
      }
    }
    if (saleInput.discountUSD !== undefined && (!isNum(saleInput.discountUSD) || saleInput.discountUSD < 0)) {
      return { success: false, error: 'Remise invalide.' };
    }
    if (!isNum(saleInput.amountPaidUSD) || saleInput.amountPaidUSD < 0) {
      return { success: false, error: 'Montant payé invalide.' };
    }

    const exchangeRate = this.state.settings.exchangeRate;
    const invoiceNumber = generateReferenceNumber('FAC');
    // 2. Prepare Items
    let subtotalUSD = 0;
    const processedItems = saleInput.items.map((item) => {
      const prod = this.getProductById(item.productId)!;
      const lineTotal = r2(item.quantity * item.unitPriceUSD);
      subtotalUSD = r2(subtotalUSD + lineTotal);
      return {
        productId: prod.id,
        productName: prod.name,
        sku: prod.sku,
        quantity: item.quantity,
        unitPriceUSD: item.unitPriceUSD,
        buyPriceUSD: prod.buyPriceUSD,
        totalUSD: lineTotal,
        unit: prod.unit,
      };
    });

    if ((saleInput.discountUSD || 0) > subtotalUSD) {
      return { success: false, error: 'La remise ne peut pas dépasser le total de la vente.' };
    }
    const totalUSD = r2(Math.max(0, subtotalUSD - (saleInput.discountUSD || 0)));
    const totalCDF = usdToCdf(totalUSD, exchangeRate);
    const amountPaidUSD = r2(Math.min(totalUSD, saleInput.amountPaidUSD));
    const amountPaidCDF = usdToCdf(amountPaidUSD, exchangeRate);
    const debtAmountUSD = r2(Math.max(0, totalUSD - amountPaidUSD));

    // A debt must be attached to a registered customer, otherwise it would be lost
    const debtCustomer = saleInput.customerId ? this.getCustomerById(saleInput.customerId) : undefined;
    if (debtAmountUSD > 0 && !debtCustomer) {
      return { success: false, error: 'Une vente à crédit ou partielle exige un client enregistré.' };
    }

    // 3. Decrement stock and record movements
    for (const item of processedItems) {
      const prod = this.getProductById(item.productId)!;
      const previousStock = prod.currentStock;
      const newStock = previousStock - item.quantity;

      prod.currentStock = newStock;
      prod.updatedAt = new Date().toISOString();

      this.addStockMovement({
        productId: prod.id,
        productName: prod.name,
        quantity: -item.quantity,
        type: 'SALE',
        reason: `Vente ${invoiceNumber} à ${saleInput.customerName}`,
        referenceNumber: invoiceNumber,
        previousStock,
        newStock,
      });
    }

    // 4. Update Customer Debt if applicable
    if (debtAmountUSD > 0 && debtCustomer) {
      const customer = debtCustomer;
      {
        customer.debtBalanceUSD = r2(customer.debtBalanceUSD + debtAmountUSD);

        // Create or update customer debt record
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30); // 30 days credit

        const newDebtRecord: DebtRecord = {
          id: generateUUID(),
          type: 'CUSTOMER',
          partyId: customer.id,
          partyName: customer.name,
          partyPhone: customer.phone,
          initialAmountUSD: debtAmountUSD,
          paidAmountUSD: 0,
          remainingBalanceUSD: debtAmountUSD,
          dueDate: dueDate.toISOString(),
          history: [],
          referenceInvoice: invoiceNumber,
        };
        this.state.debts = [newDebtRecord, ...this.state.debts];
      }
    }

    // 5. Build Sale record
    const sale: Sale = {
      currency: saleInput.currency ?? 'USD',
      id: generateUUID(),
      invoiceNumber,
      customerId: saleInput.customerId,
      customerName: saleInput.customerName,
      customerPhone: saleInput.customerPhone,
      items: processedItems,
      subtotalUSD,
      discountUSD: saleInput.discountUSD || 0,
      totalUSD,
      totalCDF,
      exchangeRate,
      paymentMethod: saleInput.paymentMethod,
      amountPaidUSD,
      amountPaidCDF,
      debtAmountUSD,
      status: 'COMPLETED',
      cashierId: this.state.currentUser.id,
      cashierName: this.state.currentUser.name,
      notes: saleInput.notes,
      date: new Date().toISOString(),
      syncStatus: this.syncStatusForNewRecord(),
    };

    this.state.sales = [sale, ...this.state.sales];
    this.enqueue('SALE_CREATE', sale);
    this.afterWrite();
    return { success: true, sale };
  }

  // Purchases & Procurement Engine
  public getPurchases(): Purchase[] {
    return this.state.purchases;
  }

  public executePurchase(purchaseInput: {
    supplierId: string;
    items: Array<{
      productId: string;
      quantity: number;
      buyPriceUSD: number;
    }>;
    additionalFeesUSD: number;
    paymentMethod: PaymentMethod;
    amountPaidUSD: number;
    status?: 'COMPLETED' | 'DRAFT' | 'PENDING';
  }): { success: boolean; purchase?: Purchase; error?: string } {
    if (!MANAGER_ROLES.includes(this.currentRole())) {
      return { success: false, error: 'Action réservée aux gestionnaires et administrateurs.' };
    }
    const supplier = this.getSupplierById(purchaseInput.supplierId);
    if (!supplier) {
      return { success: false, error: 'Fournisseur non trouvé.' };
    }
    if (!Array.isArray(purchaseInput.items) || purchaseInput.items.length === 0) {
      return { success: false, error: 'Ajoutez au moins un article à l’approvisionnement.' };
    }
    for (const it of purchaseInput.items) {
      if (!this.getProductById(it.productId)) return { success: false, error: 'Produit introuvable dans la commande.' };
      if (!isNum(it.quantity) || it.quantity <= 0) return { success: false, error: 'Quantité invalide.' };
      if (!isNum(it.buyPriceUSD) || it.buyPriceUSD < 0) return { success: false, error: 'Prix d’achat invalide.' };
    }
    if (!isNum(purchaseInput.amountPaidUSD) || purchaseInput.amountPaidUSD < 0) {
      return { success: false, error: 'Montant payé invalide.' };
    }
    if (purchaseInput.additionalFeesUSD !== undefined && (!isNum(purchaseInput.additionalFeesUSD) || purchaseInput.additionalFeesUSD < 0)) {
      return { success: false, error: 'Frais supplémentaires invalides.' };
    }

    const exchangeRate = this.state.settings.exchangeRate;
    const purchaseNumber = generateReferenceNumber('ACH');

    let subtotalUSD = 0;
    const processedItems = purchaseInput.items.map((item) => {
      const prod = this.getProductById(item.productId)!;
      const totalUSD = r2(item.quantity * item.buyPriceUSD);
      subtotalUSD = r2(subtotalUSD + totalUSD);

      return {
        productId: prod.id,
        productName: prod.name,
        quantity: item.quantity,
        buyPriceUSD: item.buyPriceUSD,
        totalUSD,
        unit: prod.unit,
      };
    });

    const totalUSD = r2(subtotalUSD + (purchaseInput.additionalFeesUSD || 0));
    const totalCDF = usdToCdf(totalUSD, exchangeRate);
    const amountPaidUSD = r2(Math.min(totalUSD, purchaseInput.amountPaidUSD));
    const debtAmountUSD = r2(Math.max(0, totalUSD - amountPaidUSD));
    const status = purchaseInput.status || 'COMPLETED';

    // If completed, increment stock
    if (status === 'COMPLETED') {
      for (const item of processedItems) {
        const prod = this.getProductById(item.productId)!;
        const previousStock = prod.currentStock;
        const newStock = previousStock + item.quantity;

        prod.currentStock = newStock;
        // Optionally update buy price if new price provided
        prod.buyPriceUSD = item.buyPriceUSD;
        prod.updatedAt = new Date().toISOString();

        this.addStockMovement({
          productId: prod.id,
          productName: prod.name,
          quantity: item.quantity,
          type: 'PURCHASE',
          reason: `Réception approvisionnement ${purchaseNumber} de ${supplier.companyName}`,
          referenceNumber: purchaseNumber,
          previousStock,
          newStock,
        });
      }

      // Update supplier debt if debtAmount > 0
      if (debtAmountUSD > 0) {
        supplier.balanceDueUSD = r2(supplier.balanceDueUSD + debtAmountUSD);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 45); // 45 days supplier credit

        const newDebtRecord: DebtRecord = {
          id: generateUUID(),
          type: 'SUPPLIER',
          partyId: supplier.id,
          partyName: supplier.companyName,
          partyPhone: supplier.phone,
          initialAmountUSD: debtAmountUSD,
          paidAmountUSD: 0,
          remainingBalanceUSD: debtAmountUSD,
          dueDate: dueDate.toISOString(),
          history: [],
          referenceInvoice: purchaseNumber,
        };
        this.state.debts = [newDebtRecord, ...this.state.debts];
      }
    }

    const purchase: Purchase = {
      id: generateUUID(),
      purchaseNumber,
      supplierId: supplier.id,
      supplierName: supplier.companyName,
      items: processedItems,
      subtotalUSD,
      additionalFeesUSD: purchaseInput.additionalFeesUSD || 0,
      totalUSD,
      totalCDF,
      exchangeRate,
      paymentMethod: purchaseInput.paymentMethod,
      amountPaidUSD,
      debtAmountUSD,
      status,
      date: new Date().toISOString(),
      syncStatus: this.syncStatusForNewRecord(),
      createdById: this.state.currentUser.id,
      createdByName: this.state.currentUser.name,
    };

    this.state.purchases = [purchase, ...this.state.purchases];
    this.enqueue('PURCHASE_CREATE', purchase);
    this.afterWrite();
    return { success: true, purchase };
  }

  // Debt & Credit Management Engine
  public getDebts(type?: 'CUSTOMER' | 'SUPPLIER'): DebtRecord[] {
    if (type) {
      return this.state.debts.filter((d) => d.type === type);
    }
    return this.state.debts;
  }

  public recordDebtRepayment(
    debtId: string,
    paymentAmountUSD: number,
    paymentMethod: PaymentMethod,
    notes?: string
  ): { success: boolean; error?: string; updatedDebt?: DebtRecord; receiptNumber?: string } {
    if (this.isBootstrapping) return { success: false, error: 'Chargement des données en cours. Réessayez après sa fin.' };
    if (!this.sessionUserId) return { success: false, error: 'Session expirée. Reconnectez-vous.' };
    const debt = this.state.debts.find((d) => d.id === debtId);
    if (!debt) return { success: false, error: 'Dossier de dette introuvable' };

    if (!isNum(paymentAmountUSD) || paymentAmountUSD <= 0) return { success: false, error: 'Le montant du versement doit être supérieur à zéro' };

    if (paymentAmountUSD > debt.remainingBalanceUSD || r2(paymentAmountUSD) > debt.remainingBalanceUSD) {
      return { success: false, error: 'Le montant dépasse le solde restant de la dette' };
    }

    if (r2(paymentAmountUSD) <= 0) return { success: false, error: 'Montant minimum : 0,01 USD' };
    const sourceSale = debt.type === 'CUSTOMER' ? this.state.sales.find(s => s.invoiceNumber === debt.referenceInvoice) : undefined;
    const exchangeRate = sourceSale?.currency === 'CDF' ? sourceSale.exchangeRate : this.state.settings.exchangeRate;
    if (!isNum(exchangeRate) || exchangeRate <= 0) return { success: false, error: 'Taux de change invalide' };
    const receiptNumber = generateReferenceNumber('REC-REM');
    const now = new Date().toISOString();

    paymentAmountUSD = r2(paymentAmountUSD);
    debt.paidAmountUSD = r2(debt.paidAmountUSD + paymentAmountUSD);
    debt.remainingBalanceUSD = r2(Math.max(0, debt.remainingBalanceUSD - paymentAmountUSD));
    debt.lastPaymentDate = now;

    debt.history.push({
      id: generateUUID(),
      date: now,
      amountUSD: paymentAmountUSD,
      amountCDF: usdToCdf(paymentAmountUSD, exchangeRate),
      exchangeRate,
      paymentMethod,
      receiptNumber,
      recordedBy: this.state.currentUser.name,
      notes,
    });

    // Update customer or supplier general balance
    if (debt.type === 'CUSTOMER') {
      const customer = this.getCustomerById(debt.partyId);
      if (customer) {
        customer.debtBalanceUSD = r2(Math.max(0, customer.debtBalanceUSD - paymentAmountUSD));
      }
    } else {
      const supplier = this.getSupplierById(debt.partyId);
      if (supplier) {
        supplier.balanceDueUSD = r2(Math.max(0, supplier.balanceDueUSD - paymentAmountUSD));
      }
    }

    const entry = debt.history[debt.history.length - 1];
    this.enqueue(debt.type === 'CUSTOMER' ? 'DEBT_PAYMENT' : 'SUPPLIER_DEBT_PAYMENT', {
      id: entry.id, debtId: debt.id, amount: sourceSale?.currency === 'CDF' ? usdToCdf(paymentAmountUSD, exchangeRate) : paymentAmountUSD, paymentMethod, reference: receiptNumber, notes,
    });
    this.afterWrite();
    return { success: true, updatedDebt: debt, receiptNumber };
  }

  // Expenses Management
  public getExpenses(): Expense[] {
    return this.state.expenses;
  }

  public addExpense(
    expenseInput: Omit<Expense, 'id' | 'date' | 'createdBy' | 'syncStatus' | 'amountCDF' | 'exchangeRate'> & {
      exchangeRate?: number;
    }
  ): Expense {
    this.requireManager();
    this.requireCorePermission('expenses.create');
    if (!isNum(expenseInput.amountUSD) || expenseInput.amountUSD <= 0) {
      throw new Error('Montant de la dépense invalide.');
    }
    const exchangeRate = expenseInput.exchangeRate || this.state.settings.exchangeRate;

    const expense: Expense = {
      ...expenseInput,
      id: generateUUID(),
      amountCDF: usdToCdf(expenseInput.amountUSD, exchangeRate),
      exchangeRate,
      receiptNumber: generateReferenceNumber('REC-DEP'),
      date: new Date().toISOString(),
      createdBy: this.state.currentUser.name,
      createdById: this.state.currentUser.id,
      syncStatus: this.syncStatusForNewRecord(),
    };

    this.state.expenses = [expense, ...this.state.expenses];
    this.enqueue('EXPENSE_CREATE', expense);
    this.afterWrite();
    return expense;
  }

  // Inventory Reconciliation Tool (Physical Count vs Theoretical Stock)
  public reconcileInventory(
    adjustments: Array<{
      productId: string;
      physicalCount: number;
      reason: string;
    }>
  ) {
    this.requireManager();
    const now = new Date().toISOString();
    for (const item of adjustments) {
      const product = this.getProductById(item.productId);
      if (!product || !isNum(item.physicalCount) || item.physicalCount < 0) continue;

      const previousStock = product.currentStock;
      const difference = item.physicalCount - previousStock;

      if (difference !== 0) {
        product.currentStock = item.physicalCount;
        product.updatedAt = now;

        this.addStockMovement({
          productId: product.id,
          productName: product.name,
          quantity: difference,
          type: difference > 0 ? 'ADJUSTMENT' : 'LOSS_DAMAGE',
          reason: `Inventaire Physique: ${item.reason} (Écart: ${difference > 0 ? '+' : ''}${difference})`,
          referenceNumber: `INV-${new Date().getTime().toString().slice(-6)}`,
          previousStock,
          newStock: item.physicalCount,
        });
      }
    }
    this.persist();
  }

  // Export / Import Database backup
  /** Backup without any PIN material (hashes stay on the device). */
  public exportDatabaseJson(): string {
    this.requireAdmin();
    const { users, currentUser, savedAt, offlineQueue, cloud, syncInfo, ...rest } = this.state;
    void currentUser;
    void savedAt;
    void offlineQueue;
    void cloud;
    void syncInfo;
    const safeUsers = users.map(({ pinHash, pinSalt, ...u }) => {
      void pinHash;
      void pinSalt;
      return u;
    });
    const payload = { ...rest, users: safeUsers };
    const serialized = JSON.stringify(payload);
    return JSON.stringify({ format: 'bta-backup', version: 3, exportedAt: new Date().toISOString(),
      checksum: backupChecksum(serialized), payload }, null, 2);
  }

  /**
   * Restores business data only. Users, PINs and the current session are NEVER replaced by a
   * backup file (otherwise a crafted file could grant admin access).
   */
   public async importDatabaseJson(jsonString: string): Promise<boolean> {
    this.requireAdmin();
    if (this.state.cloud) throw new Error('Import désactivé : cet appareil est synchronisé avec une entreprise.');
    try {
      if (jsonString.length > 30_000_000) return false;

      const parsed = JSON.parse(jsonString) as Record<string, any>;
      let payload: Partial<AppDatabaseState>;
      if (parsed?.format === 'bta-backup' && parsed.version === 3 && parsed.payload && typeof parsed.payload === 'object') {
        if (backupChecksum(JSON.stringify(parsed.payload)) !== parsed.checksum) return false;
        payload = parsed.payload as Partial<AppDatabaseState>;
      } else if (parsed?._format === 'bta-backup-v2' || parsed?.settings) {
        // Legacy unwrapped backups remain readable; the next export uses version 3.
        payload = parsed as Partial<AppDatabaseState>;
      } else return false;
      for (const key of ['reservations', 'reservationCancellations', 'reservationPayments', 'reservationDeliveries', 'stockDamages', 'freeIssues', 'importSuppliers', 'importShipments', 'importExpenses', 'importTrackingEvents', 'importPayments', 'importDocuments'] as const) {
        if (payload[key] === undefined) (payload as Record<string, unknown>)[key] = [];
      }
      if (!validateBackupData(payload)) return false;

      const previous = JSON.parse(JSON.stringify(this.state)) as AppDatabaseState;
      const backupKey = `bta_preimport_${Date.now()}_${generateUUID()}`;
      // Do not alter live state until the complete existing state has a durable recovery copy.
      await localforage.setItem(backupKey, previous);
      const next: AppDatabaseState = {
        ...this.getDefaultState(),
        ...payload,
        users: this.state.users,
        currentUser: this.state.currentUser,
        offlineQueue: [],
        syncInfo: { ...this.state.syncInfo, pendingCount: 0, errorMessage: undefined },
      } as AppDatabaseState;
      try {
        this.state = next;
        this.persist();
        await this.flushDurableAndWait();
      } catch (e) {
        this.state = previous;
        this.persist();
        await this.flushDurableAndWait();
        throw e;
      }
      return true;
    } catch (e) {
      console.error('Invalid backup JSON', e);
    }
    return false;
  }
  /** Deletes ALL products, customers, suppliers, sales, purchases, stock, expenses and debts. Accounts, PINs, settings and categories are kept. */
  public clearAllBusinessData() {
    this.requireAdmin();
    if (this.state.cloud) throw new Error('Action désactivée : cet appareil est synchronisé avec une entreprise.');
    this.state = {
      ...this.state,
           products: [],
      customers: [],
      suppliers: [],
      sales: [],
      purchases: [],
      stockMovements: [],
      expenses: [],
      debts: [],
      reservations: [],
reservationCancellations: [],
 reservationPayments: [],
      reservationDeliveries: [],
      stockDamages: [],
      freeIssues: [],
      importSuppliers: [], importShipments: [], importExpenses: [], importTrackingEvents: [], importPayments: [], importDocuments: [],
      offlineQueue: [],
      syncInfo: { ...this.state.syncInfo, pendingCount: 0 },
    };
    this.persist();
  }

  /** Erases business data (demo seed). Accounts and PINs are kept. */
  public resetToDefaultSeed() {
    this.requireAdmin();
    if (this.state.cloud) throw new Error('Action désactivée : cet appareil est synchronisé avec une entreprise.');
    const keepUsers = this.state.users;
    const keepCurrent = this.state.currentUser;
    this.state = { ...this.getDefaultState(), users: keepUsers, currentUser: keepCurrent };
    this.persist();
  }
}

export const appRepository = new AppRepository();
