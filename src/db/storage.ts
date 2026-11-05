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
import localforage from 'localforage';
import { Preferences } from '@capacitor/preferences';

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
  offlineQueue: Array<{ id: string; type: string; payload: unknown; timestamp: string }>;
  syncInfo: SyncStatusInfo;
  savedAt?: number;
}

const STORAGE_KEY = 'bta_business_transform_africa_db_v1';
const LOCKOUT_KEY = 'bta_login_lockout_v1';
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_BASE_MS = 30_000;

const ADMIN_ROLES = ['ADMIN', 'ADMINISTRATEUR'];
const MANAGER_ROLES = [...ADMIN_ROLES, 'GESTIONNAIRE', 'MANAGER'];

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
    try {
      const localSavedAt = this.state.savedAt || 0;
      let best: AppDatabaseState | null = null;
      let bestAt = localSavedAt;

      const indexedData = await localforage.getItem<AppDatabaseState>(STORAGE_KEY);
      if (indexedData && indexedData.products && (indexedData.savedAt || 0) > bestAt) {
        best = indexedData;
        bestAt = indexedData.savedAt || 0;
      }

      // Capacitor native Preferences (fallback if the WebView storage was wiped)
      const prefData = await Preferences.get({ key: STORAGE_KEY });
      if (prefData.value) {
        const parsed = JSON.parse(prefData.value) as AppDatabaseState;
        if (parsed && parsed.products && (parsed.savedAt || 0) > bestAt) {
          best = parsed;
          bestAt = parsed.savedAt || 0;
        }
      }

      if (best) {
        // Never let a hydrated copy log out / replace the current session user
        const merged = { ...this.getDefaultState(), ...best };
        merged.users = this.ensureUserPins(merged.users || INITIAL_USERS);
        merged.currentUser =
          merged.users.find((u) => u.id === (this.sessionUserId || best!.currentUser?.id)) || merged.users[0];
        this.state = merged;
        this.notify();
      }
    } catch (e) {
      console.warn('Async storage hydration warning:', e);
    }
  }

  private ensureUserPins(users: User[]): User[] {
    return users.map((u) => {
      if (!u.pinHash || !u.pinSalt) {
        const seed = INITIAL_USERS.find((x) => x.id === u.id);
        if (seed && seed.pinHash && seed.pinSalt) return { ...u, pinHash: seed.pinHash, pinSalt: seed.pinSalt };
        // No usable PIN stored: generate a random one the admin must reset (no known default).
        const salt = generateSalt(16);
        const rnd = new Uint32Array(1);
        crypto.getRandomValues(rnd);
        return { ...u, pinSalt: salt, pinHash: hashPinSync(String(100000 + (rnd[0] % 900000)), salt) };
      }
      return u;
    });
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
      offlineQueue: [],
      syncInfo: {
        status: typeof navigator !== 'undefined' && navigator.onLine ? 'ONLINE' : 'OFFLINE',
        lastSyncTime: new Date().toISOString(),
        pendingCount: 0,
      },
    };
  }

  private persist() {
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

  public async triggerSync(): Promise<boolean> {
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
    return SYNC_ENABLED ? 'PENDING' : 'SYNCED';
  }

  private afterWrite() {
    this.persist();
    if (SYNC_ENABLED && this.state.syncInfo.status !== 'OFFLINE') {
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

  private currentRole(): string {
    return this.sessionUserId ? this.state.currentUser.role : '';
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

  public getUserById(id: string): User | undefined {
    return this.state.users.find((u) => u.id === id);
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

  public updateUser(user: User) {
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
    this.requireAdmin();
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
    this.requireAdmin();
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
      if (!saleInput.allowNegativeStock && prod.currentStock < qty) {
        return {
          success: false,
          error: `Stock insuffisant pour "${prod.name}" (Stock actuel: ${prod.currentStock} ${prod.unit}, demandé: ${qty}).`,
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
    const { users, currentUser, savedAt, ...rest } = this.state;
    void currentUser;
    void savedAt;
    const safeUsers = users.map(({ pinHash, pinSalt, ...u }) => {
      void pinHash;
      void pinSalt;
      return u;
    });
    return JSON.stringify({ ...rest, users: safeUsers, _format: 'bta-backup-v2' }, null, 2);
  }

  /**
   * Restores business data only. Users, PINs and the current session are NEVER replaced by a
   * backup file (otherwise a crafted file could grant admin access).
   */
  public importDatabaseJson(jsonString: string): boolean {
    this.requireAdmin();
    try {
      if (jsonString.length > 30_000_000) return false;
      const parsed = JSON.parse(jsonString) as Partial<AppDatabaseState>;
      const arrays: Array<keyof AppDatabaseState> = [
        'categories', 'products', 'customers', 'suppliers', 'sales',
        'purchases', 'stockMovements', 'expenses', 'debts',
      ];
      if (!parsed || typeof parsed !== 'object' || !parsed.settings || typeof parsed.settings !== 'object') return false;
      for (const k of arrays) {
        if (!Array.isArray(parsed[k])) return false;
      }
      if (!isNum(parsed.settings.exchangeRate) || parsed.settings.exchangeRate <= 0) return false;
      if (parsed.products!.some((p) => !p || typeof p.id !== 'string' || !isNum(p.currentStock) || !isNum(p.sellPriceUSD))) return false;
      if (parsed.sales!.some((x) => !x || typeof x.id !== 'string' || !Array.isArray(x.items) || !isNum(x.totalUSD))) return false;

      this.state = {
        ...this.getDefaultState(),
        ...parsed,
        users: this.state.users,
        currentUser: this.state.currentUser,
        offlineQueue: Array.isArray(parsed.offlineQueue) ? parsed.offlineQueue : [],
        syncInfo: this.state.syncInfo,
      } as AppDatabaseState;
      this.persist();
      return true;
    } catch (e) {
      console.error('Invalid backup JSON', e);
    }
    return false;
  }

  /** Deletes ALL products, customers, suppliers, sales, purchases, stock, expenses and debts. Accounts, PINs, settings and categories are kept. */
  public clearAllBusinessData() {
    this.requireAdmin();
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
      offlineQueue: [],
      syncInfo: { ...this.state.syncInfo, pendingCount: 0 },
    };
    this.persist();
  }

  /** Erases business data (demo seed). Accounts and PINs are kept. */
  public resetToDefaultSeed() {
    this.requireAdmin();
    const keepUsers = this.state.users;
    const keepCurrent = this.state.currentUser;
    this.state = { ...this.getDefaultState(), users: keepUsers, currentUser: keepCurrent };
    this.persist();
  }
}

export const appRepository = new AppRepository();
