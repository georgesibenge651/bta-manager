import localforage from 'localforage';

/** Durable Core ID translation and transactional outbox stored beside the offline DB. */
const db = localforage.createInstance({
  name: 'bta_business_transform_africa',
  storeName: 'core_sync_v1',
  description: 'Core MySQL ID mapping and idempotent offline operations',
});

const mappingKey = (tenant: number, entity: string, localId: string) => `id:${tenant}:${entity}:${localId}`;

export async function mapServerId(tenant: number, entity: string, localId: string, serverId: number): Promise<void> {
  if (!Number.isSafeInteger(tenant) || tenant <= 0 || !Number.isSafeInteger(serverId) || serverId <= 0 || !localId) {
    throw new Error('Mapping Core invalide.');
  }
  await db.setItem(mappingKey(tenant, entity, localId), serverId);
  await db.setItem(`reverse:${tenant}:${entity}:${serverId}`, localId);
}

export async function getServerId(tenant: number, entity: string, localId: string): Promise<number | null> {
  const value = await db.getItem<number>(mappingKey(tenant, entity, localId));
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function getLocalId(tenant: number, entity: string, serverId: number): Promise<string | null> {
  return (await db.getItem<string>(`reverse:${tenant}:${entity}:${serverId}`)) ?? null;
}

export type CoreOperationType = 'stock_adjustment' | 'sale_create' | 'purchase_create' | 'expense_create' | 'debt_payment' | 'sale_refund';
export type CoreOperationState = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'REVIEW';

export interface CoreQueuedOperation {
  operationId: string;
  tenantId: number;
  branchId: number;
  type: CoreOperationType;
  payload: Record<string, unknown>;
  state: CoreOperationState;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const operationKey = (id: string) => `op:${id}`;
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4${Math.random().toString(16).slice(2,5)}-a${Math.random().toString(16).slice(2,5)}-${Math.random().toString(16).slice(2,14)}`;

export async function enqueueCoreOperation(input: Omit<CoreQueuedOperation, 'operationId' | 'state' | 'createdAt' | 'updatedAt' | 'attempts'> & { operationId?: string }): Promise<CoreQueuedOperation> {
  if (!Number.isSafeInteger(input.tenantId) || input.tenantId <= 0 || !Number.isSafeInteger(input.branchId) || input.branchId <= 0) {
    throw new Error('Entreprise ou établissement Core invalide.');
  }
  const operationId = input.operationId ?? uuid();
  const existing = await db.getItem<CoreQueuedOperation>(operationKey(operationId));
  if (existing) {
    if (existing.tenantId !== input.tenantId || existing.branchId !== input.branchId || existing.type !== input.type || JSON.stringify(existing.payload) !== JSON.stringify(input.payload)) {
      throw new Error('UUID déjà utilisé par une opération différente.');
    }
    return existing;
  }
  const now = new Date().toISOString();
  const operation: CoreQueuedOperation = { ...input, operationId, state: 'PENDING', createdAt: now, updatedAt: now, attempts: 0 };
  await db.setItem(operationKey(operationId), operation);
  await db.setItem(`queue:${input.tenantId}:${input.branchId}:${now}:${operationId}`, operationId);
  return operation;
}

export async function listCoreOperations(tenantId: number, branchId: number): Promise<CoreQueuedOperation[]> {
  const prefix = `queue:${tenantId}:${branchId}:`;
  const keys: string[] = [];
  await db.iterate((_id: string, key: string) => { if (key.startsWith(prefix)) keys.push(key); });
  const operations = await Promise.all(keys.sort().map(async key => {
    const id = await db.getItem<string>(key);
    return id ? db.getItem<CoreQueuedOperation>(operationKey(id)) : null;
  }));
  return operations.filter((op): op is CoreQueuedOperation => !!op && op.state !== 'DONE');
}

export async function updateCoreOperation(operation: CoreQueuedOperation): Promise<void> {
  operation.updatedAt = new Date().toISOString();
  await db.setItem(operationKey(operation.operationId), operation);
}

export async function confirmCoreOperation(operation: CoreQueuedOperation, result: Record<string, unknown>): Promise<void> {
  operation.state = 'DONE';
  operation.result = result;
  operation.error = undefined;
  await updateCoreOperation(operation);
}
