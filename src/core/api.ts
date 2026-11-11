import { Capacitor, registerPlugin } from '@capacitor/core';

interface SecureTokenPlugin {
  get(): Promise<{ value: string | null }>;
  set(options: { value: string }): Promise<void>;
  remove(): Promise<void>;
}

const SecureToken = registerPlugin<SecureTokenPlugin>('BtaSecureToken');
const TOKEN_KEY = 'bta_core_bearer_v1';
const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const CORE_API_BASE = (buildEnv?.VITE_CORE_API_BASE ||
  'https://fondationkenda.com/wp-json/bta/v1').replace(/\/+$/, '');

export class CoreApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: unknown) {
    super(message);
    this.name = 'CoreApiError';
  }
}

export async function getCoreToken(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) return (await SecureToken.get()).value;
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export async function setCoreToken(token: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Jeton Core invalide.');
  if (Capacitor.isNativePlatform()) await SecureToken.set({ value: token });
  else sessionStorage.setItem(TOKEN_KEY, token);
}

export async function clearCoreToken(): Promise<void> {
  if (Capacitor.isNativePlatform()) await SecureToken.remove();
  else { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* no-op */ } }
}

export async function coreRequest<T>(path: string, options: {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; query?: Record<string, string | number | undefined>;
  body?: unknown; auth?: boolean; timeoutMs?: number;
} = {}): Promise<T> {
  const url = new URL(`${CORE_API_BASE}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
  const token = options.auth === false ? null : await getCoreToken();
  if (options.auth !== false && !token) throw new CoreApiError(401, 'bta_unauthenticated', 'Connexion requise.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET', signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const e = payload as { code?: string; message?: string; data?: unknown } | null;
      if (response.status === 401 && options.auth !== false) {
        await clearCoreToken();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bta-core-unauthorized', { detail: { path, code: e?.code ?? 'unknown', status: response.status } }));
      }
      throw new CoreApiError(response.status, e?.code ?? 'bta_http_error', e?.message ?? `Erreur HTTP ${response.status}`, e?.data);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof CoreApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw new CoreApiError(0, 'bta_timeout', 'Le serveur ne répond pas.');
    throw new CoreApiError(0, 'bta_network_error', 'Connexion au serveur indisponible.');
  } finally { clearTimeout(timer); }
}

export const coreLogin = (email: string, password: string) =>
  coreRequest<{success: true; token: string; token_type: 'Bearer'; expires_at: string; user: CoreUser}>('auth/login', { method: 'POST', auth: false, body: { email, password } });

export interface CoreUser { id: number; name: string; email: string; status: string }
export type CoreRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER';
export interface CoreMembership { tenantId: number; name: string; role: CoreRole; active: boolean }
export interface CoreMe { success: true; user: CoreUser; memberships: CoreMembership[]; session_expires_at: string }
export interface CoreBranch { id: number; tenant_id: number; name: string; code: string; status: string }

export const coreMe = () => coreRequest<CoreMe>('auth/me');
export const coreLogout = () => coreRequest<{success: true; message: string}>('auth/logout', { method: 'POST' });
export async function coreBranches(tenantId: number): Promise<{success:true; branches:CoreBranch[]}> {
  const response = await coreRequest<{success:true; branches:Array<Record<string,unknown>>}>(`tenants/${tenantId}/branches`);
  return { ...response, branches: response.branches.map(row => ({
    id: Number(row.id), tenant_id: Number(row.tenant_id), name: String(row.name ?? ''), code: String(row.code ?? ''), status: String(row.status ?? ''),
  })).filter(branch => Number.isSafeInteger(branch.id) && branch.id > 0) };
}
export const corePermissions = (tenantId: number) => coreRequest<{success: true; permissions: Array<{permission_key: string}>; role_defaults: Record<CoreRole, string[]>}>(`tenants/${tenantId}/permissions`);
export const coreBranchPermissions = (tenantId: number, branchId: number) => coreRequest<{success:true; tenant_id:number; branch_id:number; role:CoreRole; permissions:string[]}>(`tenants/${tenantId}/branches/${branchId}/permissions/me`);

export interface CorePage<T> { success: true; [key: string]: unknown; pagination?: { page: number; per_page: number; total: number; pages: number } }
export const coreCategories = (tenantId: number, branchId: number, page = 1) => coreRequest<{success:true; categories:Array<Record<string,unknown>>; pagination?:unknown}>(`tenants/${tenantId}/categories`, { query: { branch_id: branchId, page, per_page: 100 } });
export const coreProducts = (tenantId: number, branchId: number, page = 1, perPage = 100) => coreRequest<{success:true; products:Array<Record<string,unknown>>; pagination?:unknown}>(`tenants/${tenantId}/products`, { query: { branch_id: branchId, page, per_page: perPage } });
export const coreCustomers = (tenantId: number, branchId: number) => coreRequest<{success:true; customers:Array<Record<string,unknown>>}>(`tenants/${tenantId}/customers`, { query: { branch_id: branchId } });
export const coreSuppliers = (tenantId: number, branchId: number) => coreRequest<{success:true; suppliers:Array<Record<string,unknown>>}>(`tenants/${tenantId}/suppliers`, { query: { branch_id: branchId } });
export const coreSales = (tenantId: number, page = 1, branchId?: number) => coreRequest<{success:true; sales:Array<Record<string,unknown>>; pagination?:unknown}>(`tenants/${tenantId}/sales`, { query: { page, per_page: 100, branch_id: branchId } });
export const corePurchases = (tenantId: number, page = 1, branchId?: number) => coreRequest<{success:true; purchases:Array<Record<string,unknown>>; pagination?:unknown}>(`tenants/${tenantId}/purchases`, { query: { page, per_page: 100, branch_id: branchId } });
export const coreDebts = (tenantId: number, branchId?: number) => coreRequest<{success:true; debts:Array<Record<string,unknown>>}>(`tenants/${tenantId}/debts`, { query: { branch_id: branchId } });
export const coreExpenses = (tenantId: number, branchId?: number) => coreRequest<{success:true; expenses:Array<Record<string,unknown>>}>(`tenants/${tenantId}/expenses`, { query: { branch_id: branchId } });
export const coreCashSessions = (tenantId: number, branchId: number) => coreRequest<{success:true; sessions:Array<Record<string,unknown>>}>(`tenants/${tenantId}/cash/sessions`, { query: { branch_id: branchId } });
export const coreReportSummary = (tenantId: number, branchId: number, from?: string, to?: string) => coreRequest<{success:true; period:Record<string,string>; totals:Record<string,Record<string,number>>}>(`tenants/${tenantId}/reports/summary`, { query: { branch_id: branchId, from, to } });
export const coreStock = (tenantId: number, branchId: number, cursor?: string) => coreRequest<{success:true; resource:'stock'; items:Array<Record<string,unknown>>; count:number; has_more:boolean; next_cursor:string|null; server_time:string}>(`tenants/${tenantId}/sync/pull`, { query: { branch_id: branchId, resource:'stock', limit:250, cursor } });
export const coreStockMovements = (tenantId: number, branchId: number, cursor?: string) => coreRequest<{success:true; resource:'stock_movements'; items:Array<Record<string,unknown>>; count:number; has_more:boolean; next_cursor:string|null; server_time:string}>(`tenants/${tenantId}/sync/pull`, { query: { branch_id: branchId, resource:'stock_movements', limit:250, cursor } });

export interface CoreOperationResponse { success: true; operation_id: string; duplicate: boolean; [key:string]:unknown }
export interface CoreOperationStatus { success: true; operation_id: string; status: 'PROCESSING'|'DONE'|'FAILED'|'REVIEW'; result?:Record<string,unknown>|null; error?:{code:string;message:string}|null }
export const corePushOperation = (tenantId:number, operationId:string, type:string, payload:Record<string,unknown>) =>
  coreRequest<CoreOperationResponse>(`tenants/${tenantId}/sync/push`, { method:'POST', timeoutMs:60000, body:{operation_id:operationId,type,payload} });
export const coreOperationStatus = (tenantId:number, operationId:string) =>
  coreRequest<CoreOperationStatus>(`tenants/${tenantId}/sync/operations/${operationId}`);

