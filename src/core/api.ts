import {displayCompanyName} from './branding';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

interface SecureTokenPlugin {
  get(): Promise<{ value: string | null }>;
  set(options: { value: string }): Promise<void>;
  remove(): Promise<void>;
}

const SecureToken = registerPlugin<SecureTokenPlugin>('BtaSecureToken');
const TOKEN_KEY = 'bta_core_bearer_v1';
const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
const PRODUCTION_CORE_API_BASE = 'https://fondationkenda.com/wp-json/bta/v1';
/**
 * En développement Web, les appels passent par le proxy Vite sur la même origine.
 * En production (APK et site Web), l'API Core reste l'URL HTTPS officielle.
 */
const isLocalWeb =
  typeof window !== 'undefined' &&
  !Capacitor.isNativePlatform() &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1');

export const CORE_API_BASE = (
  typeof buildEnv?.VITE_CORE_API_BASE === 'string' && buildEnv.VITE_CORE_API_BASE
    ? buildEnv.VITE_CORE_API_BASE
    : isLocalWeb
      ? '/__bta_core_proxy/wp-json/bta/v1'
      : PRODUCTION_CORE_API_BASE
).replace(/\/+$/, '');


export class CoreApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: unknown) {
    super(displayCompanyName(message));
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

type Sent = { ok: boolean; status: number; payload: unknown };

/**
 * Android : CapacitorHttp évite les restrictions CORS du WebView.
 * Web en développement : le proxy Vite relaie les appels sur la même origine.
 * Web en production : fetch utilise directement l'API HTTPS officielle.
 */
function encodeFormData(data: unknown): string {
  const params = new URLSearchParams();

  const append = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      value.forEach((item, index) => append(`${key}[${index}]`, item));
      return;
    }

    if (typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(
        ([childKey, childValue]) => append(`${key}[${childKey}]`, childValue)
      );
      return;
    }

    params.append(key, String(value));
  };

  if (data && typeof data === 'object') {
    Object.entries(data as Record<string, unknown>).forEach(
      ([key, value]) => append(key, value)
    );
  }

  return params.toString();
}

async function sendRequest(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  signal: AbortSignal
): Promise<Sent> {
  const formBody = body === undefined ? undefined : encodeFormData(body);

  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({
      url: url.toString(),
      method,
      headers,
      ...(formBody === undefined ? {} : { data: formBody }),
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });

    let payload: unknown = r.data;

    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }

    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      payload,
    };
  }

  const response = await fetch(url, {
    method,
    signal,
    headers,
    ...(formBody === undefined ? {} : { body: formBody }),
  });

  return {
    ok: response.ok,
    status: response.status,
    payload: await response.json().catch(() => null),
  };
}


export async function coreRequest<T>(path: string, options: {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; query?: Record<string, string | number | undefined>;
  body?: unknown; auth?: boolean; timeoutMs?: number;
} = {}): Promise<T> {
  const base = CORE_API_BASE.startsWith('/')
    ? `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost'}${CORE_API_BASE}`
    : CORE_API_BASE;
  const url = new URL(`${base}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
  const token = options.auth === false ? null : await getCoreToken();
  if (options.auth !== false && !token) throw new CoreApiError(401, 'bta_unauthenticated', 'Connexion requise.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const sent = await sendRequest(url, options.method ?? 'GET',
      {
  Accept: 'application/json',
  ...(options.body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }),
  ...(token ? { Authorization: `Bearer ${token}` } : {})
},
      options.body, options.timeoutMs ?? 20000, controller.signal);
    const payload = sent.payload;
    if (!sent.ok) {
      const e = payload as { code?: string; message?: string; data?: unknown } | null;
      if (sent.status === 401 && options.auth !== false) {
        await clearCoreToken();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bta-core-unauthorized', { detail: { path, code: e?.code ?? 'unknown', status: sent.status } }));
      }
      throw new CoreApiError(sent.status, e?.code ?? 'bta_http_error', e?.message ?? `Erreur HTTP ${sent.status}`, e?.data);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof CoreApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new CoreApiError(0, 'bta_timeout', 'Le serveur ne répond pas (délai dépassé).');
    }

    const diagnostic = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);

    console.error('[BTA Core Network Diagnostic]', diagnostic);

    throw new CoreApiError(
      0,
      'bta_network_error',
      `Erreur réseau détectée : ${diagnostic}`
    );
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
export const coreCustomers = (tenantId: number, branchId: number, page = 1) => coreRequest<{success:true; customers:Array<Record<string,unknown>>;pagination?:unknown}>(`tenants/${tenantId}/customers`, { query: { branch_id: branchId, page, per_page: 100 } });
export const coreSuppliers = (tenantId: number, branchId: number, page = 1) => coreRequest<{success:true; suppliers:Array<Record<string,unknown>>;pagination?:unknown}>(`tenants/${tenantId}/suppliers`, { query: { branch_id: branchId, page, per_page: 100 } });
export const coreSales = (tenantId: number, page = 1, branchId?: number) => coreRequest<{success:true; sales:Array<Record<string,unknown>>; pagination?:unknown}>(`tenants/${tenantId}/sales`, { query: { page, per_page: 100, branch_id: branchId } });
export const corePurchases = (tenantId: number, page = 1, branchId?: number) => coreRequest<{success:true; purchases:Array<Record<string,unknown>>; pagination?:unknown}>(`tenants/${tenantId}/purchases`, { query: { page, per_page: 100, branch_id: branchId } });
export const coreDebts = (tenantId: number, branchId?: number, page = 1) => coreRequest<{success:true; debts:Array<Record<string,unknown>>;pagination?:unknown}>(`tenants/${tenantId}/debts`, { query: { branch_id: branchId, page, per_page: 100 } });
export const coreExpenses = (tenantId: number, branchId?: number) => coreRequest<{success:true; expenses:Array<Record<string,unknown>>}>(`tenants/${tenantId}/expenses`, { query: { branch_id: branchId } });
export const coreOpenCash = (tenantId: number, branchId: number, currency: 'USD'|'CDF', opening_amount: number) => coreRequest<{success:true; session_id:number}>(`tenants/${tenantId}/cash/sessions`, {method:'POST', body:{branch_id:branchId,currency,opening_amount}});
export const coreCloseCash = (tenantId: number, sessionId: number, closing_amount: number) => coreRequest<{success:true; difference:number}>(`tenants/${tenantId}/cash/sessions/${sessionId}/close`, {method:'POST',body:{closing_amount}});
export const coreCashSessions = (tenantId: number, branchId: number) => coreRequest<{success:true; sessions:Array<Record<string,unknown>>}>(`tenants/${tenantId}/cash/sessions`, { query: { branch_id: branchId } });
export const coreReportSummary = (tenantId: number, branchId: number, from?: string, to?: string) => coreRequest<{success:true; period:Record<string,string>; totals:Record<string,Record<string,number>>}>(`tenants/${tenantId}/reports/summary`, { query: { branch_id: branchId, from, to } });
export const coreStock = (tenantId: number, branchId: number, cursor?: string) => coreRequest<{success:true; resource:'stock'; items:Array<Record<string,unknown>>; count:number; has_more:boolean; next_cursor:string|null; server_time:string}>(`tenants/${tenantId}/sync/pull`, { query: { branch_id: branchId, resource:'stock', limit:250, cursor } });
export const coreStockMovements = (tenantId: number, branchId: number, cursor?: string) => coreRequest<{success:true; resource:'stock_movements'; items:Array<Record<string,unknown>>; count:number; has_more:boolean; next_cursor:string|null; server_time:string}>(`tenants/${tenantId}/sync/pull`, { query: { branch_id: branchId, resource:'stock_movements', limit:250, cursor } });

export const coreCargoUpsert = (tenantId: number, branchId: number, pkg: Record<string, unknown>) =>
  coreRequest<{success:true; package_id:string; duplicate:boolean; updated_at:string}>(`tenants/${tenantId}/cargo/packages`, { method:'POST', timeoutMs:60000, body:{ branch_id:branchId, package:pkg } });
export const coreCargoPull = (tenantId: number, branchId: number) =>
  coreRequest<{success:true; packages:Array<{id:string;data:Record<string,any>;updated_at:string}>;count:number;server_time:string}>(`tenants/${tenantId}/cargo/packages`, { query:{ branch_id:branchId } });
// À ajouter dans src/core/api.ts, juste après coreCargoPull.
export type CoreImportExportRecordType =
  | 'supplier'
  | 'shipment'
  | 'expense'
  | 'tracking'
  | 'payment'
  | 'document';

export interface CoreImportExportRecord {
  id: string;
  type: CoreImportExportRecordType;
  data: Record<string, unknown>;
  updated_at?: string;
}

export const coreImportExportUpsert = (
  tenantId: number,
  branchId: number,
  record: CoreImportExportRecord,
) =>
  coreRequest<{
    success: true;
    record_id: string;
    record_type: CoreImportExportRecordType;
    duplicate: boolean;
    updated_at: string;
  }>(`tenants/${tenantId}/import-export/records`, {
    method: 'POST',
    timeoutMs: 60000,
    body: { branch_id: branchId, record },
  });

export const coreImportExportPull = (tenantId: number, branchId: number) =>
  coreRequest<{
    success: true;
    records: CoreImportExportRecord[];
    count: number;
    server_time: string;
  }>(`tenants/${tenantId}/import-export/records`, {
    query: { branch_id: branchId },
  });
export interface CoreOperationResponse { success: true; operation_id: string; duplicate: boolean; [key:string]:unknown }
export interface CoreOperationStatus { success: true; operation_id: string; status: 'PROCESSING'|'DONE'|'FAILED'|'REVIEW'; result?:Record<string,unknown>|null; error?:{code:string;message:string}|null }
export const corePushOperation = (tenantId:number, operationId:string, type:string, payload:Record<string,unknown>) =>
  coreRequest<CoreOperationResponse>(`tenants/${tenantId}/sync/push`, { method:'POST', timeoutMs:60000, body:{operation_id:operationId,type,payload} });
export const coreOperationStatus = (tenantId:number, operationId:string) =>
  coreRequest<CoreOperationStatus>(`tenants/${tenantId}/sync/operations/${operationId}`);


/** An image is acknowledged independently before its product is transmitted. */
export async function coreUploadProductImage(tenantId:number, branchId:number, dataUrl:string):Promise<string> {
  const encoded=dataUrl.split(',')[1] ?? '';
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const sha=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  const result=await coreRequest<{success:boolean;sha256:string;image_url:string}>(`tenants/${tenantId}/products/image`,{method:'POST',timeoutMs:60000,body:{branch_id:branchId,data_url:dataUrl}});
  if(result.success!==true||result.sha256!==sha||!/^https?:\/\//.test(result.image_url))throw new CoreApiError(503,'bta_image_invalid_ack','Confirmation image invalide ; photo locale conservée.');
  return result.image_url;
}

export type InvitationRole = 'ADMIN'|'MANAGER'|'CASHIER';
export interface CoreInvitation {id:number; tenant_id:number; role:InvitationRole; branches:number[]; status:string; expires_at:string; created_at?:string}
export const coreInvitations = (tenantId:number) => coreRequest<{success:true;invitations:CoreInvitation[]}>(`tenants/${tenantId}/invitations`);
export const coreCreateInvitation = (tenantId:number,role:InvitationRole,branches:number[]) => coreRequest<{success:true;code:string;invitation:CoreInvitation}>(`tenants/${tenantId}/invitations`,{method:'POST',body:{role,branches}});
export const coreRevokeInvitation = (id:number) => coreRequest<{success:true}>(`invitations/${id}/revoke`,{method:'POST'});
export const coreRegisterInvited = (code:string,full_name:string,email:string,password:string) => coreRequest<{success:true;token:string;tenantId:number}>('auth/register-invited',{method:'POST',auth:false,body:{code,full_name,email,password}});
export const coreRegisterOwner = (full_name:string,email:string,password:string,company_name:string,branch_name:string,license_code:string) => coreRequest<{success:true;token:string;tenantId:number;branchId:number}>('auth/register-owner',{method:'POST',auth:false,body:{full_name,email,password,company_name,branch_name,license_code}});
export const coreAcceptInvitation = (code:string) => coreRequest<{success:true;tenantId:number}>('invitations/accept',{method:'POST',body:{code}});
export type CoreHistoryResource='sales'|'debts'|'payments'|'refunds';
export const coreHistoryPage=(tenantId:number,branchId:number,resource:CoreHistoryResource,cursor=0)=>coreRequest<{success:true;tenant_id:number;branch_id:number;resource:CoreHistoryResource;items:Array<Record<string,unknown>>;has_more:boolean;next_cursor:number|null}>(`tenants/${tenantId}/history/${resource}`,{query:{branch_id:branchId,cursor}});
