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
import { isTransient, pullAll, pushOps, PullCursor } from './cloudSync';
import localforage from 'localforage';
import { Preferences } from '@capacitor/preferences';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

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
  offlineQueue: Array<{ id: string; type: string; payload: unknown; timestamp: string }>;
  syncInfo: SyncStatusInfo;
  /** Synchronisation entreprise (Firestore) : présent seulement une fois la migration/jonction faite. */
  cloud?: {
    tenantId: string;
    branchId: string;
    lastPull: number;
    baseline: Baseline;
    rejections: Array<{ at: string; reason: string }>;
    pullCursor?: PullCursor;
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
  const optional = ['reservations', 'reservationCancellations', 'reservationPayments', 'reservationDeliveries', 'stockDamages', 'freeIssues'] as const;
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
  /** Incrémenté à chaque changement local capturé : permet d'abandonner une lecture serveur périmée. */
  private rev = 0;

  constructor() {
    this.state = this.loadFromStorage();
    this.initAsyncStorage();
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
reservations: [],
reservationCancellations: [],
reservationPayments: [],
reservationDeliveries: [],
stockDamages: [],
freeIssues: [],
      offlineQueue: [],
      syncInfo: {
        status: typeof navigator !== 'undefined' && navigator.onLine ? 'ONLINE' : 'OFFLINE',
        lastSyncTime: new Date().toISOString(),
        pendingCount: 0,
      },
    };
  }

  /** Transforme les changements locaux depuis la dernière base de référence en opérations en file. */
  private captureChanges() {
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
    this.persistTimer = null;
    const snapshot = JSON.parse(JSON.stringify(this.state)) as AppDatabaseState;
    // Layer 2: IndexedDB via localforage
    localforage.setItem(STORAGE_KEY, snapshot).catch((err) => {
      console.warn('LocalForage IndexedDB persistence warning:', err);
    });
    // Layer 3: Capacitor native Preferences
    Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(snapshot) }).catch(() => {
      // Ignored outside the native shell
    });
  }

  private async flushDurableAndWait() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    const snapshot = JSON.parse(JSON.stringify(this.state)) as AppDatabaseState;
    await Promise.all([
      localforage.setItem(STORAGE_KEY, snapshot),
      Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(snapshot) }),
    ]);
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
      reservationPayments: [], reservationDeliveries: [], stockDamages: [], freeIssues: [],
      offlineQueue: [],
      cloud: { tenantId, branchId, lastPull: 0, baseline: makeBaseline({
        settings: INITIAL_SETTINGS, categories: [], products: [], customers: [], suppliers: [], sales: [], purchases: [],
        stockMovements: [], expenses: [], debts: [], reservations: [], reservationCancellations: [],
        reservationPayments: [], reservationDeliveries: [], stockDamages: [], freeIssues: [],
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
      reservationPayments: [], reservationDeliveries: [], stockDamages: [], freeIssues: [],
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
      const authState = await FirebaseAuthentication.getCurrentUser();
      const firebaseUid = authState.user?.uid;
      if (!firebaseUid || firebaseUid !== this.state.currentUser.firebaseUid) {
        throw new Error('Le profil local n’est pas associé au compte Firebase actuellement connecté. Les opérations restent en attente.');
      }
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
      cloud.pullCursor ??= {
        since: Math.max(0, cloud.lastPull - 60_000), // recouvrement contre dérive d'horloge et égalités de version
        collectionIndex: 0, serverTime: 0, recovered: 0,
      };
      this.persist();
      await this.flushDurableAndWait();
      const completed = await pullAll(ctx, cloud.pullCursor, async (collection, docs, cursor) => {
        if (rev !== this.rev || this.state.offlineQueue.length > 0) {
          throw new Error('Une saisie locale est arrivée pendant la lecture ; reprise après son envoi.');
        }
        if (docs.length) applyPulled(this.state as unknown as Record<string, unknown>, cloud.baseline, collection, docs);
        cloud.pullCursor = cursor;
        this.state.syncInfo.syncProgress = { collection, recovered: cursor.recovered, phase: 'PULL' };
        this.persist();
        // Acknowledged progress survives an abrupt native process exit.
        await this.flushDurableAndWait();
      });
      cloud.lastPull = completed.serverTime || Date.now();
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
          collection: PULL_ORDER[Math.min(this.state.cloud.pullCursor.collectionIndex, PULL_ORDER.length - 1)] ?? 'lecture',
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

  private scheduleBackToOnline(ms: number) {
    setTimeout(() => {
      if (this.state.syncInfo.status === 'SYNCED') {
        this.state.syncInfo.status = 'ONLINE';
        this.notify();
      }
    }, ms);
  }

  /** Queues a record for the server (only when a server is configured). */
  private enqueue(type: string, payload: { id: string }) {
    if (this.state.cloud) return; // le mode entreprise déduit les opérations par comparaison (captureChanges)
    if (!SYNC_ENABLED) return;
    this.state.offlineQueue.push({
      id: generateUUID(),
      type,
      payload,
      timestamp: new Date().toISOString(),
    });
    this.state.syncInfo.pendingCount = this.state.offlineQueue.length;
  }

  private syncStatusForNewRecord(): 'SYNCED' | 'PENDING' {
    // Local-only mode: nothing to wait for. Server mode: pending until the server confirms.
    return SYNC_ENABLED || this.state.cloud ? 'PENDING' : 'SYNCED';
  }

  private afterWrite() {
    this.persist();
    if ((SYNC_ENABLED || this.state.cloud) && this.state.syncInfo.status !== 'OFFLINE') {
      void this.triggerSync();
    }
  }

  // Getters
  public getState(): AppDatabaseState {
    return this.state;
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
    if (!ADMIN_ROLES.includes(this.currentRole())) throw new Error('Action réservée à l’administrateur.');
  }

  private requireManager() {
    if (!MANAGER_ROLES.includes(this.currentRole())) throw new Error('Action réservée aux gestionnaires et administrateurs.');
  }

  private requireLoggedIn() {
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
    const newCat: Category = {
      id: `cat-${generateUUID().substring(0, 8)}`,
      name,
      description,
      iconName,
      color,
    };
    this.state.categories = [...this.state.categories, newCat];
    this.persist();
    return newCat;
  }

  public updateCategory(category: Category) {
    this.requireManager();
    this.state.categories = this.state.categories.map((c) => (c.id === category.id ? category : c));
    this.persist();
  }

  public deleteCategory(categoryId: string): boolean {
    this.requireManager();
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
      this.persist();
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
      this.persist();
      return newProduct;
    }
  }

  public deleteProduct(id: string) {
    this.requireManager();
    this.state.products = this.state.products.filter((p) => p.id !== id);
    this.persist();
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
    this.persist();
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
      this.persist();
      return updated;
    } else {
      const newCustomer: Customer = {
        ...customerData,
        id: `cust-${generateUUID().substring(0, 8)}`,
        registeredAt: new Date().toISOString(),
      };
      this.state.customers = [newCustomer, ...this.state.customers];
      this.persist();
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
    if (supplierData.id) {
      const existing = this.getSupplierById(supplierData.id);
      if (!existing) throw new Error('Fournisseur introuvable.');
      const updated: Supplier = {
        ...existing,
        ...supplierData,
        id: supplierData.id,
      };
      this.state.suppliers = this.state.suppliers.map((s) => (s.id === updated.id ? updated : s));
      this.persist();
      return updated;
    } else {
      const newSupplier: Supplier = {
        ...supplierData,
        id: `supp-${generateUUID().substring(0, 8)}`,
        registeredAt: new Date().toISOString(),
      };
      this.state.suppliers = [newSupplier, ...this.state.suppliers];
      this.persist();
      return newSupplier;
    }
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
    notes?: string;
    allowNegativeStock?: boolean;
  }): { success: boolean; sale?: Sale; error?: string } {
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
    if (!this.sessionUserId) return { success: false, error: 'Session expirée. Reconnectez-vous.' };
    const debt = this.state.debts.find((d) => d.id === debtId);
    if (!debt) return { success: false, error: 'Dossier de dette introuvable' };

    if (!isNum(paymentAmountUSD) || paymentAmountUSD <= 0) return { success: false, error: 'Le montant du versement doit être supérieur à zéro' };

    if (paymentAmountUSD > debt.remainingBalanceUSD + 0.01) {
      return { success: false, error: 'Le montant dépasse le solde restant de la dette' };
    }

    const exchangeRate = this.state.settings.exchangeRate;
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

    this.persist();
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
      for (const key of ['reservations', 'reservationCancellations', 'reservationPayments', 'reservationDeliveries', 'stockDamages', 'freeIssues'] as const) {
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
